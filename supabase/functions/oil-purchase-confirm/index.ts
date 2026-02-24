import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, requireUserId, requireHuman } from '../_shared/supabase.ts';
import { getGameConfig } from '../_shared/mining.ts';
import { logSecurityEvent, extractClientInfo, isFeatureEnabled, validateRange } from '../_shared/security.ts';

const DEV_PORTAL_API = 'https://developer.worldcoin.org/api/v2/minikit/transaction';

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

    const { payload } = await req.json();
    if (!payload?.reference || !payload?.transaction_id) {
      throw new Error('Missing payment payload');
    }

    const appId = Deno.env.get('WORLD_APP_ID') || Deno.env.get('APP_ID');
    const apiKey = Deno.env.get('DEV_PORTAL_API_KEY') || Deno.env.get('WORLD_ID_API_KEY');
    if (!appId || !apiKey) {
      throw new Error('Missing developer portal credentials');
    }

    const admin = getAdminClient();

    const { data: purchase } = await admin
      .from('oil_purchases')
      .select('*')
      .eq('reference', payload.reference)
      .eq('user_id', userId)
      .single();

    if (!purchase) {
      throw new Error('Purchase not found');
    }

    if (purchase.status === 'confirmed') {
      return new Response(JSON.stringify({ ok: true, status: 'confirmed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Eagerly store transaction_id so the batch verifier can pick it up later
    // if this function crashes before completing.
    if (payload.transaction_id && !purchase.transaction_id) {
      await admin
        .from('oil_purchases')
        .update({ transaction_id: payload.transaction_id })
        .eq('id', purchase.id)
        .eq('status', 'pending');
    }

    const verifyRes = await fetch(`${DEV_PORTAL_API}/${payload.transaction_id}?app_id=${appId}&type=payment`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!verifyRes.ok) {
      throw new Error('Failed to verify transaction');
    }

    const tx = await verifyRes.json();

    const txRef = tx?.reference;
    if (txRef && txRef !== payload.reference) {
      throw new Error('Reference mismatch');
    }

    const txTo = tx?.to ?? tx?.recipientAddress;
    if (txTo && purchase.to_address && txTo.toLowerCase() !== purchase.to_address.toLowerCase()) {
      throw new Error('Treasury address mismatch');
    }

    // Phase 5: Verify transaction amount matches expected payment
    // World API may return camelCase (inputTokenAmount) or nested input_token
    const rawAmount = tx?.input_token?.amount ?? tx?.inputTokenAmount;
    if (rawAmount) {
      let txAmount = parseFloat(rawAmount);
      if (txAmount > 1e9) txAmount = txAmount / 1e18; // raw wei → token units
      const expectedAmount = Number(purchase.amount_token);
      // Allow 1% tolerance for rounding
      if (txAmount < expectedAmount * 0.99) {
        const clientInfo = extractClientInfo(req);
        logSecurityEvent({
          event_type: 'suspicious_activity',
          user_id: userId,
          severity: 'critical',
          action: 'underpayment_attempt',
          details: { expected: expectedAmount, received: txAmount, reference: payload.reference },
          ...clientInfo,
        });
        throw new Error('Transaction amount mismatch');
      }
    }

    const txStatus = tx?.transaction_status ?? tx?.transactionStatus;
    if (txStatus === 'failed') {
      await admin
        .from('oil_purchases')
        .update({ status: 'failed', transaction_id: payload.transaction_id, metadata: tx })
        .eq('id', purchase.id);
      throw new Error('Transaction failed');
    }

    const status = txStatus;
    const minedStatuses = ['mined', 'completed', 'confirmed', 'success'];

    if (status && !minedStatuses.includes(status)) {
      return new Response(JSON.stringify({ ok: true, status: tx.transaction_status }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Credit OIL
    const { data: state } = await admin
      .from('player_state')
      .select('oil_balance')
      .eq('user_id', userId)
      .single();

    const newOil = Number(state?.oil_balance || 0) + Number(purchase.amount_oil || 0);

    await admin
      .from('player_state')
      .update({ oil_balance: newOil })
      .eq('user_id', userId);

    await admin
      .from('oil_purchases')
      .update({ status: 'confirmed', transaction_id: payload.transaction_id, metadata: tx })
      .eq('id', purchase.id);
    // --- Referral Bonus Logic ---
    // Check if this user was referred and hasn't paid bonus yet
    const { data: profile } = await admin
      .from('profiles')
      .select('referred_by, referral_bonus_paid')
      .eq('id', userId)
      .single();

    if (profile?.referred_by && !profile.referral_bonus_paid) {
      // Fetch dynamic config for bonus amount
      const config = await getGameConfig();
      const bonusAmount = config.referrals?.bonus_diamonds ?? 0.5;

      // Award bonus diamonds to the referrer
      const { data: referrerState } = await admin
        .from('player_state')
        .select('diamond_balance')
        .eq('user_id', profile.referred_by)
        .single();

      const newDiamonds = Number(referrerState?.diamond_balance || 0) + bonusAmount;

      await admin
        .from('player_state')
        .update({ diamond_balance: newDiamonds })
        .eq('user_id', profile.referred_by);

      // Log the referral bonus
      await admin
        .from('referral_bonuses')
        .insert({
          referrer_id: profile.referred_by,
          referred_id: userId,
          diamonds_awarded: bonusAmount,
        });

      // Mark bonus as paid
      await admin
        .from('profiles')
        .update({ referral_bonus_paid: true })
        .eq('id', userId);
    }
    // --- End Referral Bonus Logic ---

    // Log successful purchase confirmation
    logSecurityEvent({
      event_type: 'purchase_confirmed',
      user_id: userId,
      severity: 'info',
      action: 'oil_purchase',
      details: { oil_amount: purchase.amount_oil, reference: payload.reference },
    });

    return new Response(JSON.stringify({ ok: true, status: 'confirmed', oil_balance: newOil }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const clientInfo = extractClientInfo(req);
    logSecurityEvent({
      event_type: 'purchase_failed',
      severity: 'warning',
      action: 'oil_purchase_confirm',
      details: { error: (err as Error).message },
      ...clientInfo,
    });
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
