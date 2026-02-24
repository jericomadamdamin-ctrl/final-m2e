import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, requireUserId, requireHuman } from '../_shared/supabase.ts';
import { getGameConfig, ensurePlayerState, processMining } from '../_shared/mining.ts';
import { logSecurityEvent, extractClientInfo, isFeatureEnabled } from '../_shared/security.ts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

    const userId = await requireUserId(req);
    await requireHuman(userId);
    const { diamonds } = await req.json();
    const requestedDiamonds = Math.floor(Number(diamonds || 0));

    if (requestedDiamonds <= 0 || isNaN(requestedDiamonds) || !Number.isFinite(requestedDiamonds)) {
      throw new Error('Invalid diamond amount');
    }

    if (requestedDiamonds > 1000000) {
      throw new Error('Maximum payout request is 1,000,000 diamonds');
    }

    // Phase 0: Feature flag check
    const cashoutEnabled = await isFeatureEnabled('cashout_enabled');
    if (!cashoutEnabled) {
      throw new Error('Cashout temporarily disabled');
    }

    const config = await getGameConfig();
    if (!config.cashout?.enabled) {
      throw new Error('Cashout disabled');
    }

    const minRequired = Number(config.cashout.minimum_diamonds_required || 0);
    if (requestedDiamonds < minRequired) {
      throw new Error(`Minimum ${minRequired} diamonds required`);
    }

    await ensurePlayerState(userId);
    await processMining(userId);

    const admin = getAdminClient();
    const { data: state } = await admin
      .from('player_state')
      .select('diamond_balance')
      .eq('user_id', userId)
      .single();

    const currentDiamonds = Number(state?.diamond_balance || 0);
    if (currentDiamonds < requestedDiamonds) {
      throw new Error('Insufficient diamonds');
    }

    const now = new Date();
    const roundDate = now.toISOString().slice(0, 10);

    // Always attach to an OPEN round. If today's previous round is already closed,
    // create a fresh round so users can continue requesting cashout.
    let { data: round } = await admin
      .from('cashout_rounds')
      .select('*')
      .eq('round_date', roundDate)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!round) {
      const revenueWindowStart = new Date(Date.now() - MS_PER_DAY).toISOString();
      const revenueWindowEnd = now.toISOString();

      // Backward-compatible fallback: if old DB still has UNIQUE(round_date),
      // duplicate-date inserts fail; then we roll to next available date.
      let createRoundDate = roundDate;
      let createdRound: any = null;
      let createError: { message?: string } | null = null;
      for (let i = 0; i < 14; i++) {
        const attemptDate = new Date(now.getTime() + i * MS_PER_DAY).toISOString().slice(0, 10);
        const { data, error } = await admin
          .from('cashout_rounds')
          .insert({
            round_date: attemptDate,
            revenue_window_start: revenueWindowStart,
            revenue_window_end: revenueWindowEnd,
            revenue_wld: 0,
            payout_pool_wld: 0,
            total_diamonds: 0,
            status: 'open',
          })
          .select('*')
          .single();
        if (!error && data) {
          createRoundDate = attemptDate;
          createdRound = data;
          createError = null;
          break;
        }
        createError = error;
      }

      if (!createdRound) {
        throw new Error(`Failed to open cashout round: ${createError?.message || 'unknown error'}`);
      }

      round = createdRound;
      console.log(`Created new cashout round ${round.id} for date ${createRoundDate}`);
    }

    if (!round) throw new Error('Failed to open cashout round');

    // Keep round pool synced with latest window revenue so users see fairer variable payouts.
    const revenueWindowStart = round.revenue_window_start || new Date(Date.now() - MS_PER_DAY).toISOString();
    const revenueWindowEnd = now.toISOString();
    const { data: revenueRows } = await admin
      .from('oil_purchases')
      .select('amount_wld')
      .eq('status', 'confirmed')
      .gte('created_at', revenueWindowStart)
      .lte('created_at', revenueWindowEnd);

    const revenueWld = (revenueRows || []).reduce((sum, r: { amount_wld: number }) => sum + Number(r.amount_wld || 0), 0);
    const { data: exchangeRateSetting } = await admin
      .from('global_game_settings')
      .select('value')
      .eq('key', 'diamond_wld_exchange_rate')
      .single();
    const exchangeRate = Number(exchangeRateSetting?.value || 0.1);
    const estimatedPool = Number(round.total_diamonds || 0) * exchangeRate;

    const { data: refreshedRound } = await admin
      .from('cashout_rounds')
      .update({
        revenue_window_start: revenueWindowStart,
        revenue_window_end: revenueWindowEnd,
        revenue_wld: revenueWld,
        payout_pool_wld: estimatedPool,
      })
      .eq('id', round.id)
      .select('*')
      .single();

    if (refreshedRound) {
      round = refreshedRound;
    }

    // Atomic RPC Call (Replaces manual decrement + insert to prevent double-spend)
    const { data: rpcResult, error: rpcError } = await admin.rpc('submit_cashout_request', {
      p_user_id: userId,
      p_diamonds: requestedDiamonds,
      p_round_id: round.id
    });

    if (rpcError) throw rpcError;

    const result = rpcResult as any;
    if (!result.ok) {
      throw new Error(result.message || 'Cashout request failed');
    }

    const { request_id, new_balance } = result;

    // Construct response object to match previous shape if needed by frontend, 
    // or just return success.
    // The frontend likely expects the request object.
    const requestRow = {
      id: request_id,
      user_id: userId,
      diamonds_submitted: requestedDiamonds,
      payout_round_id: round.id,
      status: 'pending',
      requested_at: new Date().toISOString()
    };

    // We already updated round totals in RPC.
    round.total_diamonds = Number(round.total_diamonds || 0) + requestedDiamonds;
    round.payout_pool_wld = round.total_diamonds * exchangeRate;

    // Always signal autonomous worker.
    const { error: signalError } = await admin.rpc('signal_cashout_round', {
      p_round_id: round.id,
    });
    if (signalError) {
      console.warn('cashout round signal failed:', signalError.message);
    }

    // Immediate settlement path:
    // 1) finalize the round now
    // 2) execute payouts now
    // 3) if execution call fails, refund this user's payout immediately
    const settlement = {
      finalized: false,
      executed: false,
      refunded: false,
      message: 'Settlement queued',
    };

    try {
      const { data: finalizeResult, error: finalizeError } = await admin.rpc('finalize_cashout_round', {
        p_round_id: round.id,
        p_manual_pool_wld: null,
        p_actor_id: userId,
      });
      if (finalizeError) {
        throw new Error(`Finalize failed: ${finalizeError.message}`);
      }
      settlement.finalized = Boolean((finalizeResult as any)?.ok);

      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
      const adminAccessKey = Deno.env.get('ADMIN_ACCESS_KEY');
      const invokeToken = serviceRoleKey || anonKey;
      if (!supabaseUrl || !invokeToken || !adminAccessKey) {
        throw new Error('Missing settlement env: SUPABASE_URL/(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY)/ADMIN_ACCESS_KEY');
      }

      const executeRes = await fetch(`${supabaseUrl}/functions/v1/cashout-execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${invokeToken}`,
          apikey: invokeToken,
          'x-admin-key': adminAccessKey,
          'x-request-id': crypto.randomUUID(),
        },
        body: JSON.stringify({
          round_id: round.id,
          retry_failed: true,
          batch_size: 50,
        }),
      });

      const executePayload = await executeRes.json().catch(() => ({}));
      if (!executeRes.ok || executePayload?.error) {
        throw new Error(String(executePayload?.error || `Execute failed with status ${executeRes.status}`));
      }
      settlement.executed = true;
      settlement.message = 'Settlement executed';
    } catch (settlementErr) {
      const reason = `Immediate settlement failed: ${(settlementErr as Error).message}`;
      console.error(reason);

      const { data: payoutRow } = await admin
        .from('cashout_payouts')
        .select('id, status')
        .eq('round_id', round.id)
        .eq('user_id', userId)
        .maybeSingle();

      if (payoutRow && payoutRow.status !== 'paid' && payoutRow.status !== 'refunded') {
        const { data: refundResult, error: refundError } = await admin.rpc('refund_cashout_payout', {
          p_payout_id: payoutRow.id,
          p_reason: reason,
        });
        if (!refundError && (refundResult as any)?.ok) {
          settlement.refunded = true;
          settlement.message = 'Settlement failed, diamonds refunded';
        } else {
          settlement.message = 'Settlement failed and refund attempt also failed';
          console.error('refund attempt failed:', refundError?.message);
        }
      } else {
        settlement.message = 'Settlement failed before payout row became refundable';
      }
    }

    // Log successful cashout request
    logSecurityEvent({
      event_type: 'cashout_request',
      user_id: userId,
      severity: 'info',
      action: 'cashout_submit',
      details: { diamonds: requestedDiamonds, round_id: round.id, settlement },
    });

    return new Response(JSON.stringify({ ok: true, request: requestRow, round, settlement }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const clientInfo = extractClientInfo(req);
    logSecurityEvent({
      event_type: 'validation_failed',
      severity: 'warning',
      action: 'cashout_request',
      details: { error: (err as Error).message },
      ...clientInfo,
    });
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
