import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, requireUserId, requireAdminOrKey } from '../_shared/supabase.ts';
import { ethers } from 'https://esm.sh/ethers@6.11.1';

// World Chain Constants
const DEFAULT_RPC_URL = 'https://worldchain-mainnet.g.alchemy.com/public';
const DEFAULT_WLD_ADDRESS = '0x2cfc85d8e48f8eab294be644d9e25c3030863003';

const ERC20_ABI = [
    "function transfer(address to, uint256 value) returns (bool)",
    "function balanceOf(address owner) view returns (uint256)"
];

Deno.serve(async (req) => {
    const preflight = handleOptions(req);
    if (preflight) return preflight;

    try {
        if (req.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), {
                status: 405,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Allow admin-key-only auth for CLI/script calls
        const adminKey = req.headers.get('x-admin-key');
        const requiredKey = Deno.env.get('ADMIN_ACCESS_KEY');

        if (adminKey && requiredKey && adminKey === requiredKey) {
            // Admin key auth — no session token needed
            console.log('Admin key auth accepted for cashout-execute');
        } else {
            // Normal auth flow
            const userId = await requireUserId(req);
            await requireAdminOrKey(req, userId);
        }

        const { round_id, retry_failed, batch_size } = await req.json();
        if (!round_id) throw new Error('Missing round_id');
        const commandId = req.headers.get('x-request-id') || crypto.randomUUID();
        const retryFailed = Boolean(retry_failed);
        const batchSize = Number.isFinite(Number(batch_size)) ? Math.max(1, Math.min(100, Number(batch_size))) : 25;

        const admin = getAdminClient();

        const { data: round, error: roundError } = await admin
            .from('cashout_rounds')
            .select('id, status')
            .eq('id', round_id)
            .single();

        if (roundError || !round) {
            throw new Error(`Round not found: ${round_id}`);
        }

        if (round.status === 'open') {
            throw new Error('Round must be finalized (closed) before execution');
        }

        console.log(JSON.stringify({
            event: 'cashout_execute_command',
            command_id: commandId,
            round_id,
            retry_failed: retryFailed,
            batch_size: batchSize,
        }));

        const { data: claimedBatch, error: claimError } = await admin.rpc('claim_cashout_payout_batch', {
            p_round_id: round_id,
            p_limit: batchSize,
            p_retry_failed: retryFailed,
        });

        if (claimError) {
            throw new Error(`Failed to claim payout batch: ${claimError.message}`);
        }

        const payouts = (claimedBatch || []) as Array<{
            payout_id: string;
            user_id: string;
            payout_wld: number;
            diamonds_burned: number;
            wallet_address: string | null;
            attempt_count: number;
        }>;

        if (payouts.length === 0) {
            const { data: completion } = await admin.rpc('complete_cashout_round_if_done', { p_round_id: round_id });
            return new Response(JSON.stringify({
                ok: true,
                command_id: commandId,
                results: [],
                completion,
                message: 'No payouts claimed for execution batch.',
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const privateKey = Deno.env.get('PAYOUT_PRIVATE_KEY');
        // Use environment variables if set, otherwise fallback to World Chain defaults
        const rpcUrl = Deno.env.get('JSON_RPC_URL') || DEFAULT_RPC_URL;
        const wldContractAddress = Deno.env.get('WLD_CONTRACT_ADDRESS') || DEFAULT_WLD_ADDRESS;

        if (!privateKey) throw new Error('Missing PAYOUT_PRIVATE_KEY');

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet = new ethers.Wallet(privateKey, provider);
        const contract = new ethers.Contract(wldContractAddress, ERC20_ABI, wallet);
        const transferFn = contract.getFunction("transfer");
        const balanceOfFn = contract.getFunction("balanceOf");
        if (!transferFn || !balanceOfFn) {
            throw new Error("Required ERC20 functions are unavailable");
        }

        let treasuryBalanceWei = await balanceOfFn(wallet.address) as bigint;
        const results = [];

        // Process payouts
        for (const payout of payouts) {
            try {
                // Safe casting to access joined profile data
                const payoutId = payout.payout_id;
                const recipientAddress = payout.wallet_address;
                const amountWld = Number(payout.payout_wld || 0);

                if (!recipientAddress || !ethers.isAddress(recipientAddress)) {
                    const { data: refundResult } = await admin.rpc('refund_cashout_payout', {
                        p_payout_id: payoutId,
                        p_reason: 'Invalid wallet address',
                    });
                    results.push({ id: payoutId, status: 'refunded', error: 'Invalid wallet address', refund: refundResult });
                    continue;
                }

                if (amountWld <= 0) {
                    const { data: refundResult } = await admin.rpc('refund_cashout_payout', {
                        p_payout_id: payoutId,
                        p_reason: 'Amount is zero',
                    });
                    results.push({ id: payoutId, status: 'refunded', error: 'Amount is zero', refund: refundResult });
                    continue;
                }

                // Processing WLD (ERC20) Transfer on World Chain
                // Note: The backend wallet must hold ETH for gas fees on World Chain (unless sponsored)
                // and WLD tokens for the payout.

                const amountWei = ethers.parseUnits(amountWld.toString(), 18);
                if (treasuryBalanceWei < amountWei) {
                    const reason = `Insufficient treasury balance: need ${amountWei.toString()}, have ${treasuryBalanceWei.toString()}`;
                    const { data: refundResult } = await admin.rpc('refund_cashout_payout', {
                        p_payout_id: payoutId,
                        p_reason: reason,
                    });
                    results.push({ id: payoutId, status: 'refunded', error: reason, refund: refundResult });
                    continue;
                }

                console.log(`Sending ${amountWld} WLD (${amountWei}) to ${recipientAddress}`);
                const tx = await transferFn(recipientAddress, amountWei);
                console.log(`Transaction sent: ${tx.hash}`);
                await tx.wait(1); // Wait for 1 confirmation

                // Update database
                const { error: paidUpdateError } = await admin
                    .from('cashout_payouts')
                    .update({
                        status: 'paid',
                        tx_hash: tx.hash,
                        last_error: null,
                        processing_started_at: null,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', payoutId);

                if (paidUpdateError) {
                    throw new Error(`Tx sent but DB update failed: ${paidUpdateError.message}`);
                }

                results.push({ id: payoutId, status: 'paid', tx: tx.hash });
                treasuryBalanceWei = treasuryBalanceWei - amountWei;

            } catch (err) {
                const payoutId = payout.payout_id;
                const errorMessage = (err as Error).message;
                console.error(`Payout failed for ${payoutId}:`, err);
                if (errorMessage.startsWith('Tx sent but DB update failed')) {
                    await admin
                        .from('cashout_payouts')
                        .update({
                            status: 'failed',
                            last_error: errorMessage,
                            processing_started_at: null,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', payoutId);
                    results.push({ id: payoutId, status: 'failed', error: errorMessage });
                } else {
                    const { data: refundResult } = await admin.rpc('refund_cashout_payout', {
                        p_payout_id: payoutId,
                        p_reason: errorMessage,
                    });
                    results.push({ id: payoutId, status: 'refunded', error: errorMessage, refund: refundResult });
                }
            }
        }

        const { data: completion } = await admin.rpc('complete_cashout_round_if_done', { p_round_id: round_id });

        return new Response(JSON.stringify({ ok: true, command_id: commandId, results, completion }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
