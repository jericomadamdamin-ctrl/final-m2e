import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, requireUserId, requireAdminOrKey } from '../_shared/supabase.ts';

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const commandId = req.headers.get('x-request-id') || crypto.randomUUID();
    const userId = await requireUserId(req);
    await requireAdminOrKey(req, userId);

    const { round_id, auto_heal } = await req.json().catch(() => ({}));
    const autoHeal = Boolean(auto_heal);

    const admin = getAdminClient();

    const { data: roundsData, error: roundsError } = await admin
      .from('cashout_rounds')
      .select('id, round_date, status, total_diamonds, payout_pool_wld')
      .order('created_at', { ascending: false });
    if (roundsError) throw roundsError;

    const rounds = (roundsData || []).filter((r: any) => !round_id || r.id === round_id);
    const roundById = new Map(rounds.map((r: any) => [r.id, r]));
    const roundIds = rounds.map((r: any) => r.id);

    if (roundIds.length === 0) {
      return jsonResponse({
        ok: true,
        command_id: commandId,
        summary: {
          open_with_requests_no_payouts: 0,
          closed_ready_to_paid: 0,
          diamond_mismatches: 0,
        },
        details: { open_with_requests_no_payouts: [], closed_ready_to_paid: [], diamond_mismatches: [] },
        healed: [],
      });
    }

    const { data: requests, error: reqError } = await admin
      .from('cashout_requests')
      .select('payout_round_id, status, diamonds_submitted')
      .in('payout_round_id', roundIds);
    if (reqError) throw reqError;

    const { data: payouts, error: payoutError } = await admin
      .from('cashout_payouts')
      .select('round_id, status, diamonds_burned')
      .in('round_id', roundIds);
    if (payoutError) throw payoutError;

    const reqByRound = new Map<string, any[]>();
    const payoutByRound = new Map<string, any[]>();
    for (const r of (requests || [])) {
      const key = r.payout_round_id as string;
      if (!reqByRound.has(key)) reqByRound.set(key, []);
      reqByRound.get(key)!.push(r);
    }
    for (const p of (payouts || [])) {
      const key = p.round_id as string;
      if (!payoutByRound.has(key)) payoutByRound.set(key, []);
      payoutByRound.get(key)!.push(p);
    }

    const openWithRequestsNoPayouts: Array<Record<string, unknown>> = [];
    const closedReadyToPaid: Array<Record<string, unknown>> = [];
    const diamondMismatches: Array<Record<string, unknown>> = [];
    const refundMismatches: Array<Record<string, unknown>> = [];

    for (const round of rounds) {
      const reqRows = reqByRound.get(round.id) || [];
      const payoutRows = payoutByRound.get(round.id) || [];
      const actionableReqs = reqRows.filter((r: any) => r.status === 'pending' || r.status === 'approved');
      const outstanding = payoutRows.filter((p: any) => p.status === 'pending' || p.status === 'processing' || p.status === 'failed');
      const approvedPaidReqDiamonds = reqRows
        .filter((r: any) => r.status === 'approved' || r.status === 'paid')
        .reduce((sum: number, r: any) => sum + Number(r.diamonds_submitted || 0), 0);
      const payoutDiamonds = payoutRows.reduce((sum: number, p: any) => sum + Number(p.diamonds_burned || 0), 0);

      if (round.status === 'open' && actionableReqs.length > 0 && payoutRows.length === 0) {
        openWithRequestsNoPayouts.push({
          round_id: round.id,
          round_date: round.round_date,
          actionable_requests: actionableReqs.length,
        });
      }

      if (round.status === 'closed' && payoutRows.length > 0 && outstanding.length === 0) {
        closedReadyToPaid.push({
          round_id: round.id,
          round_date: round.round_date,
        });
      }

      if ((round.status === 'closed' || round.status === 'paid') && approvedPaidReqDiamonds !== payoutDiamonds) {
        diamondMismatches.push({
          round_id: round.id,
          round_date: round.round_date,
          request_diamonds: approvedPaidReqDiamonds,
          payout_diamonds: payoutDiamonds,
        });
      }

      const refundedReqs = reqRows.filter((r: any) => r.status === 'refunded').length;
      const refundedPayouts = payoutRows.filter((p: any) => p.status === 'refunded').length;
      if (refundedReqs !== refundedPayouts) {
        refundMismatches.push({
          round_id: round.id,
          round_date: round.round_date,
          refunded_requests: refundedReqs,
          refunded_payouts: refundedPayouts,
        });
      }
    }

    const healed: Array<Record<string, unknown>> = [];
    if (autoHeal) {
      for (const row of closedReadyToPaid) {
        const candidateRoundId = String(row.round_id);
        const { data: completion, error: completionError } = await admin.rpc('complete_cashout_round_if_done', {
          p_round_id: candidateRoundId,
        });
        if (!completionError) {
          healed.push({
            round_id: candidateRoundId,
            result: completion,
          });
        }
      }
    }

    console.log(JSON.stringify({
      event: 'cashout_reconcile',
      command_id: commandId,
      actor_id: userId,
      scoped_round_id: round_id || null,
      auto_heal: autoHeal,
      findings: {
        open_with_requests_no_payouts: openWithRequestsNoPayouts.length,
        closed_ready_to_paid: closedReadyToPaid.length,
        diamond_mismatches: diamondMismatches.length,
      }
    }));

    return jsonResponse({
      ok: true,
      command_id: commandId,
      summary: {
        open_with_requests_no_payouts: openWithRequestsNoPayouts.length,
        closed_ready_to_paid: closedReadyToPaid.length,
        diamond_mismatches: diamondMismatches.length,
        refund_mismatches: refundMismatches.length,
      },
      details: {
        open_with_requests_no_payouts: openWithRequestsNoPayouts,
        closed_ready_to_paid: closedReadyToPaid,
        diamond_mismatches: diamondMismatches,
        refund_mismatches: refundMismatches,
      },
      healed,
      scoped_round: round_id ? roundById.get(round_id) || null : null,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
