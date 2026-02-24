import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, requireUserId, requireAdminOrKey } from '../_shared/supabase.ts';
import { ethers } from 'https://esm.sh/ethers@6.11.1';

const DEFAULT_RPC_URL = 'https://worldchain-mainnet.g.alchemy.com/public';
const DEFAULT_WLD_ADDRESS = '0x2cfc85d8e48f8eab294be644d9e25c3030863003';

const ERC20_ABI = [
    "function transfer(address to, uint256 value) returns (bool)",
    "function balanceOf(address owner) view returns (uint256)"
];

function jsonResponse(body: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

Deno.serve(async (req) => {
    const preflight = handleOptions(req);
    if (preflight) return preflight;

    try {
        if (req.method !== 'POST') {
            return jsonResponse({ error: 'Method not allowed' }, 405);
        }

        const adminKey = req.headers.get('x-admin-key');
        const requiredKey = Deno.env.get('ADMIN_ACCESS_KEY');

        if (adminKey && requiredKey && adminKey === requiredKey) {
            console.log('Admin key auth accepted for season-payout');
        } else {
            const userId = await requireUserId(req);
            await requireAdminOrKey(req, userId);
        }

        const { season_id } = await req.json();
        if (!season_id) throw new Error('Missing season_id');

        const admin = getAdminClient();

        const { data: season } = await admin
            .from('seasons')
            .select('id, status, revenue_wld')
            .eq('id', season_id)
            .single();

        if (!season) throw new Error('Season not found');
        if (season.status !== 'rewarded') {
            throw new Error(`Season must be in "rewarded" status to execute payouts. Current: "${season.status}"`);
        }

        const results: Array<{ id: string; rank: number; type: string; status: string; amount?: number; tx?: string; error?: string }> = [];

        // ── WLD Payouts (ranks 1-10) ──
        const { data: wldRewards, error: wldErr } = await admin
            .from('season_rewards')
            .select('id, user_id, rank, reward_wld, profiles!inner(wallet_address)')
            .eq('season_id', season_id)
            .eq('status', 'pending')
            .gt('reward_wld', 0)
            .order('rank', { ascending: true });

        if (wldErr) throw wldErr;

        if (wldRewards && wldRewards.length > 0) {
            const privateKey = Deno.env.get('PAYOUT_PRIVATE_KEY');
            const rpcUrl = Deno.env.get('JSON_RPC_URL') || DEFAULT_RPC_URL;
            const wldContractAddress = Deno.env.get('WLD_CONTRACT_ADDRESS') || DEFAULT_WLD_ADDRESS;

            if (!privateKey) {
                for (const r of wldRewards) {
                    await admin
                        .from('season_rewards')
                        .update({ status: 'failed' })
                        .eq('id', r.id);
                    results.push({ id: r.id, rank: r.rank, type: 'wld', status: 'failed', error: 'PAYOUT_PRIVATE_KEY not configured' });
                }
            } else {
                const provider = new ethers.JsonRpcProvider(rpcUrl);
                const wallet = new ethers.Wallet(privateKey, provider);
                const contract = new ethers.Contract(wldContractAddress, ERC20_ABI, wallet);
                const transferFn = contract.getFunction("transfer");
                const balanceOfFn = contract.getFunction("balanceOf");

                let treasuryBalance = await balanceOfFn(wallet.address) as bigint;

                for (const reward of wldRewards) {
                    try {
                        const recipientAddress = (reward as any).profiles?.wallet_address;
                        const amountWld = Number(reward.reward_wld);

                        if (!recipientAddress || !ethers.isAddress(recipientAddress)) {
                            await admin.from('season_rewards').update({ status: 'failed' }).eq('id', reward.id);
                            results.push({ id: reward.id, rank: reward.rank, type: 'wld', status: 'failed', error: 'Invalid wallet address' });
                            continue;
                        }

                        if (amountWld <= 0) {
                            await admin.from('season_rewards').update({ status: 'failed' }).eq('id', reward.id);
                            results.push({ id: reward.id, rank: reward.rank, type: 'wld', status: 'failed', error: 'Zero amount' });
                            continue;
                        }

                        const amountWei = ethers.parseUnits(amountWld.toString(), 18);

                        if (treasuryBalance < amountWei) {
                            await admin.from('season_rewards').update({ status: 'failed' }).eq('id', reward.id);
                            results.push({ id: reward.id, rank: reward.rank, type: 'wld', status: 'failed', error: 'Insufficient treasury balance' });
                            continue;
                        }

                        console.log(`[season-payout] Sending ${amountWld} WLD to ${recipientAddress} (rank ${reward.rank})`);
                        const tx = await transferFn(recipientAddress, amountWei);
                        await tx.wait(1);

                        await admin
                            .from('season_rewards')
                            .update({ status: 'paid', tx_hash: tx.hash, paid_at: new Date().toISOString() })
                            .eq('id', reward.id);

                        results.push({ id: reward.id, rank: reward.rank, type: 'wld', status: 'paid', amount: amountWld, tx: tx.hash });
                        treasuryBalance = treasuryBalance - amountWei;
                    } catch (err) {
                        console.error(`[season-payout] WLD payout failed for rank ${reward.rank}:`, err);
                        await admin.from('season_rewards').update({ status: 'failed' }).eq('id', reward.id);
                        results.push({ id: reward.id, rank: reward.rank, type: 'wld', status: 'failed', error: (err as Error).message });
                    }
                }
            }
        }

        // ── Oil Payouts (ranks 11-20) ──
        const { data: oilRewards, error: oilErr } = await admin
            .from('season_rewards')
            .select('id, user_id, rank, reward_oil')
            .eq('season_id', season_id)
            .eq('status', 'pending')
            .gt('reward_oil', 0);

        if (oilErr) throw oilErr;

        for (const reward of (oilRewards ?? [])) {
            try {
                const oilAmount = Number(reward.reward_oil);

                const { data: state } = await admin
                    .from('player_state')
                    .select('oil_balance')
                    .eq('user_id', reward.user_id)
                    .single();

                const newOil = Number(state?.oil_balance || 0) + oilAmount;

                const { error: updateErr } = await admin
                    .from('player_state')
                    .update({ oil_balance: newOil })
                    .eq('user_id', reward.user_id);

                if (updateErr) throw updateErr;

                await admin
                    .from('season_rewards')
                    .update({ status: 'paid', paid_at: new Date().toISOString() })
                    .eq('id', reward.id);

                results.push({ id: reward.id, rank: reward.rank, type: 'oil', status: 'paid', amount: oilAmount });
            } catch (err) {
                console.error(`[season-payout] Oil payout failed for rank ${reward.rank}:`, err);
                await admin.from('season_rewards').update({ status: 'failed' }).eq('id', reward.id);
                results.push({ id: reward.id, rank: reward.rank, type: 'oil', status: 'failed', error: (err as Error).message });
            }
        }

        const paid = results.filter((r) => r.status === 'paid').length;
        const failed = results.filter((r) => r.status === 'failed').length;

        return jsonResponse({ ok: true, season_id, paid, failed, results });
    } catch (err) {
        console.error('season-payout error:', (err as Error).message);
        return jsonResponse({ error: (err as Error).message }, 400);
    }
});
