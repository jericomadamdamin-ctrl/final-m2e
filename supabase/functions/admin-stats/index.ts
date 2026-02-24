
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, verifyAdmin, requireUserId } from '../_shared/supabase.ts';
import { checkRateLimit } from '../_shared/security.ts';

Deno.serve(async (req) => {
    const preflight = handleOptions(req);
    if (preflight) return preflight;

    try {
        if (req.method !== 'GET' && req.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), {
                status: 405,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const userId = await requireUserId(req);
        await verifyAdmin(req);

        const rate = await checkRateLimit(userId, 'admin_stats', 60, 1);
        if (!rate.allowed) {
            throw new Error('Admin rate limit exceeded. Try again in a minute.');
        }

        const admin = getAdminClient();

        // Fetch open rounds
        const { data: openRounds } = await admin
            .from('cashout_rounds')
            .select('*')
            .eq('status', 'open')
            .order('created_at', { ascending: false });

        // Fetch rounds with outstanding payouts (pending/processing/failed)
        const { data: outstandingPayouts } = await admin
            .from('cashout_payouts')
            .select('*, profiles(wallet_address)')
            .in('status', ['pending', 'processing', 'failed']);

        // Group payouts by round_id
        const payoutsByRound: Record<string, any[]> = {};
        if (outstandingPayouts) {
            for (const p of outstandingPayouts) {
                if (!payoutsByRound[p.round_id]) payoutsByRound[p.round_id] = [];
                payoutsByRound[p.round_id].push(p);
            }
        }

        // Fetch details for rounds that have pending payouts
        const roundIds = Object.keys(payoutsByRound);
        let pendingExecutionRounds: any[] = [];
        if (roundIds.length > 0) {
            const { data: rounds } = await admin
                .from('cashout_rounds')
                .select('*')
                .in('id', roundIds);
            pendingExecutionRounds = rounds || [];
        }

        // Attach payouts to rounds
        const executionRounds = pendingExecutionRounds.map(r => ({
            ...r,
            payouts: payoutsByRound[r.id],
            payout_summary: (payoutsByRound[r.id] || []).reduce((acc: Record<string, number>, payout: any) => {
                const key = payout.status || 'unknown';
                acc[key] = (acc[key] || 0) + 1;
                return acc;
            }, {}),
        }));

        const openRoundIds = new Set((openRounds || []).map((r: any) => r.id));
        const { data: actionableRequests } = await admin
            .from('cashout_requests')
            .select('payout_round_id')
            .in('status', ['pending', 'approved']);
        const openRoundsWithActionableRequests = new Set(
            (actionableRequests || [])
                .map((r: any) => r.payout_round_id)
                .filter((id: string | null) => !!id && openRoundIds.has(id))
        ).size;

        const { data: closedRounds } = await admin
            .from('cashout_rounds')
            .select('id')
            .eq('status', 'closed');
        const outstandingRoundIds = new Set(Object.keys(payoutsByRound));

        const { data: paidPayoutRows } = await admin
            .from('cashout_payouts')
            .select('round_id')
            .eq('status', 'paid');
        const roundsWithAnyPaid = new Set((paidPayoutRows || []).map((p: any) => p.round_id));
        const { count: refundedPayoutCount } = await admin
            .from('cashout_payouts')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'refunded');
        const closedReadyToPromote = (closedRounds || []).filter((r: any) =>
            roundsWithAnyPaid.has(r.id) && !outstandingRoundIds.has(r.id)
        ).length;

        // Global Stats
        const { count: totalUsers } = await admin.from('profiles').select('*', { count: 'exact', head: true });

        // Aggregates: totals and daily revenue (UTC)
        const { data: totalsRow } = await admin
            .from('player_state')
            .select('sum(oil_balance) as total_oil, sum(diamond_balance) as total_diamonds')
            .single();
        const totalOil = Number(totalsRow?.total_oil || 0);
        const totalDiamonds = Number(totalsRow?.total_diamonds || 0);

        const now = new Date();
        const startUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

        const sumConfirmed = async (table: string, field: string) => {
            const { data } = await admin
                .from(table)
                .select(`sum(${field})`)
                .eq('status', 'confirmed')
                .gte('created_at', startUtc)
                .single();
            return Number((data as any)?.[`sum`] ?? 0);
        };

        const dailyOil = await sumConfirmed('oil_purchases', 'amount_wld');
        const dailyMachines = await sumConfirmed('machine_purchases', 'amount_wld');
        const dailySlots = await sumConfirmed('slot_purchases', 'amount_wld');
        const dailyRevenueWldTotal = dailyOil + dailyMachines + dailySlots;

        return new Response(JSON.stringify({
            open_rounds: openRounds || [],
            execution_rounds: executionRounds,
            total_users: totalUsers || 0,
            total_oil: totalOil,
            total_diamonds: totalDiamonds,
            // Keep this aligned with payout-pool basis (oil purchases only).
            daily_revenue_wld: dailyOil,
            daily_revenue_wld_total: dailyRevenueWldTotal,
            daily_revenue_wld_machine: dailyMachines,
            daily_revenue_wld_slot: dailySlots,
            reconciliation: {
                outstanding_rounds: roundIds.length,
                open_rounds_with_actionable_requests: openRoundsWithActionableRequests,
                closed_rounds_ready_to_paid: closedReadyToPromote,
                refunded_payouts: refundedPayoutCount || 0,
            },
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
