import { getAdminClient } from '../_shared/supabase.ts';

type RoundRow = {
  id: string;
  created_at: string;
  updated_at?: string;
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function getNumericSetting(admin: ReturnType<typeof getAdminClient>, key: string, fallback: number): Promise<number> {
  const { data } = await admin
    .from('global_game_settings')
    .select('value')
    .eq('key', key)
    .single();
  const parsed = Number(data?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });

  try {
    const cronSecret = Deno.env.get('CRON_CASHOUT_SECRET');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const cronKeyHeader = req.headers.get('x-cron-key');
    const authBearer = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    const isAuthorized =
      (cronSecret && (cronKeyHeader === cronSecret || authBearer === cronSecret)) ||
      (serviceRoleKey && authBearer === serviceRoleKey);

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const admin = getAdminClient();
    const startedAt = Date.now();

    const autoEnabled = await getNumericSetting(admin, 'cashout_auto_finalize_enabled', 1);
    const finalizeIntervalSeconds = await getNumericSetting(admin, 'cashout_finalize_interval_seconds', 120);
    const executeBatchSize = await getNumericSetting(admin, 'cashout_auto_execute_batch_size', 25);

    if (autoEnabled !== 1) {
      console.warn('[cron-cashout-auto] auto mode disabled by setting; skipping run');
      return new Response(JSON.stringify({
        ok: true,
        message: 'cashout auto mode disabled',
      }), { headers: JSON_HEADERS });
    }

    const now = Date.now();
    const cutoffIso = new Date(now - finalizeIntervalSeconds * 1000).toISOString();

    const { data: openRounds } = await admin
      .from('cashout_rounds')
      .select('id, created_at, updated_at')
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .limit(50);

    const { data: signaledRounds } = await admin
      .from('cashout_round_signals')
      .select('round_id, last_signaled_at')
      .order('last_signaled_at', { ascending: true })
      .limit(100);

    const { data: actionableRequests } = await admin
      .from('cashout_requests')
      .select('payout_round_id, status')
      .in('status', ['pending', 'approved'])
      .not('payout_round_id', 'is', null);

    const actionableRoundIds = new Set((actionableRequests || []).map((r: any) => r.payout_round_id as string));
    const signaledRoundIds = new Set((signaledRounds || []).map((r: any) => r.round_id as string));
    const candidates = new Set<string>();

    for (const round of (openRounds || []) as RoundRow[]) {
      if (!actionableRoundIds.has(round.id)) continue;
      const refTime = round.updated_at || round.created_at;
      if (refTime <= cutoffIso || signaledRoundIds.has(round.id)) {
        candidates.add(round.id);
      }
    }

    const finalized: Array<Record<string, unknown>> = [];
    for (const roundId of candidates) {
      const { data, error } = await admin.rpc('finalize_cashout_round', {
        p_round_id: roundId,
        p_manual_pool_wld: null,
        p_actor_id: null,
      });
      if (error) {
        finalized.push({ round_id: roundId, ok: false, error: error.message });
      } else {
        finalized.push({ round_id: roundId, ok: true, result: data });
      }
      await admin.from('cashout_round_signals').delete().eq('round_id', roundId);
    }

    const { data: outstandingPayouts } = await admin
      .from('cashout_payouts')
      .select('round_id, status')
      .in('status', ['pending', 'failed'])
      .limit(500);
    const executeRoundIds = [...new Set((outstandingPayouts || []).map((p: any) => p.round_id as string))];

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const adminAccessKey = Deno.env.get('ADMIN_ACCESS_KEY');
    const executeResults: Array<Record<string, unknown>> = [];

    if (!supabaseUrl || !serviceRoleKey || !adminAccessKey) {
      executeResults.push({
        ok: false,
        error: 'Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or ADMIN_ACCESS_KEY',
      });
    } else {
      for (const roundId of executeRoundIds) {
        const res = await fetch(`${supabaseUrl}/functions/v1/cashout-execute`, {
          method: 'POST',
          headers: {
            ...JSON_HEADERS,
            Authorization: `Bearer ${serviceRoleKey}`,
            'x-admin-key': adminAccessKey,
            'x-request-id': crypto.randomUUID(),
          },
          body: JSON.stringify({
            round_id: roundId,
            retry_failed: true,
            batch_size: executeBatchSize,
          }),
        });
        const payload = await res.json().catch(() => ({}));
        executeResults.push({
          round_id: roundId,
          ok: res.ok,
          response: payload,
        });
      }
    }

    const summary = {
      auto_enabled: true,
      finalize_candidates: candidates.size,
      finalized_success: finalized.filter((r) => r.ok).length,
      finalized_failed: finalized.filter((r) => !r.ok).length,
      execute_rounds: executeRoundIds.length,
      execute_failed: executeResults.filter((r) => !r.ok).length,
      elapsed_ms: Date.now() - startedAt,
    };

    console.log('[cron-cashout-auto]', JSON.stringify(summary));
    return new Response(JSON.stringify({ ok: true, summary, finalized, executeResults }), {
      headers: JSON_HEADERS,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
});
