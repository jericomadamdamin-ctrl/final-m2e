import { getAdminClient } from '../_shared/supabase.ts';
import { logSecurityEvent } from '../_shared/security.ts';
import { getGameConfig } from '../_shared/mining.ts';

/**
 * Cron-triggered payment verification.
 *
 * Authenticates via `Authorization: Bearer <CRON_SECRET>` (set as a Supabase
 * secret) so it can be invoked by pg_cron + pg_net without a user session.
 *
 * Flow:
 *   1. Fetch all pending purchases that have a `transaction_id`.
 *   2. Verify each against the World Dev Portal API.
 *   3. Credit the user if payment succeeded and they haven't been credited yet.
 *   4. Also expire stale pending purchases that are older than 24 h and have
 *      no transaction_id (user abandoned before paying).
 */

/* ── World API constants ──────────────────────────────────────────── */
const DEV_PORTAL_API = 'https://developer.worldcoin.org/api/v2/minikit/transaction';
const SUCCESS_STATUSES = ['mined', 'completed', 'confirmed', 'success'];

type PurchaseType = 'oil' | 'machine' | 'slot';

const tableFor = (t: PurchaseType) =>
  t === 'oil' ? 'oil_purchases' : t === 'machine' ? 'machine_purchases' : 'slot_purchases';

/* ── Per-row verifier ─────────────────────────────────────────────── */

async function verifyOneRow(
  admin: ReturnType<typeof getAdminClient>,
  purchase: Record<string, unknown>,
  type: PurchaseType,
  appId: string,
  apiKey: string,
): Promise<{ id: string; type: PurchaseType; status: string; credited: boolean; detail?: string }> {
  const table = tableFor(type);
  const id = purchase.id as string;
  const transactionId = purchase.transaction_id as string | undefined;

  if (purchase.status !== 'pending') {
    return { id, type, status: 'already_processed', credited: false };
  }
  if (!transactionId) {
    return { id, type, status: 'no_txid', credited: false };
  }

  /* ── Call World Dev Portal ─────────────────────────────────────── */
  const verifyRes = await fetch(
    `${DEV_PORTAL_API}/${transactionId}?app_id=${appId}&type=payment`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!verifyRes.ok) {
    const text = await verifyRes.text().catch(() => '');
    return { id, type, status: 'api_error', credited: false, detail: `${verifyRes.status}: ${text.slice(0, 200)}` };
  }
  const tx = await verifyRes.json();

  /* ── Reference match (log mismatch but don't block) ────────────── */
  const txRef = tx?.reference;
  if (txRef && purchase.reference && txRef !== purchase.reference) {
    // Log but continue — the payment is real, reference may differ due to
    // the MiniKit race-condition (now mitigated by dedup in initiate).
    console.warn(`[cron] Reference mismatch for ${type} ${id}: world=${txRef} db=${purchase.reference}`);
  }

  /* ── Amount validation (±1 %) ──────────────────────────────────── */
  const rawAmount = tx?.input_token?.amount ?? tx?.inputTokenAmount;
  if (rawAmount) {
    let txAmount = parseFloat(rawAmount);
    if (txAmount > 1e9) txAmount = txAmount / 1e18;
    const expected = Number(purchase.amount_token ?? purchase.amount_wld);
    if (Number.isFinite(expected) && Number.isFinite(txAmount) && txAmount < expected * 0.99) {
      await logSecurityEvent({
        event_type: 'suspicious_activity',
        user_id: purchase.user_id as string,
        severity: 'critical',
        action: 'cron_underpayment',
        details: { expected, received: txAmount, reference: purchase.reference, type },
      }).catch(() => {});
      return { id, type, status: 'underpaid', credited: false };
    }
  }

  /* ── Transaction status gate ───────────────────────────────────── */
  const txStatus = tx?.transaction_status ?? tx?.transactionStatus;

  if (txStatus === 'failed') {
    await admin.from(table).update({ status: 'failed', metadata: tx }).eq('id', id);
    return { id, type, status: 'tx_failed', credited: false };
  }

  if (txStatus && !SUCCESS_STATUSES.includes(txStatus)) {
    return { id, type, status: `pending_onchain_${txStatus}`, credited: false };
  }

  /* ── Double-credit detection ───────────────────────────────────── */
  let alreadyCredited = false;

  if (type === 'machine') {
    const machineType = purchase.machine_type as string;
    const userId = purchase.user_id as string;
    const [{ data: ownedRows }, { data: confirmedRows }] = await Promise.all([
      admin.from('player_machines').select('id').eq('user_id', userId).eq('type', machineType),
      admin.from('machine_purchases').select('id').eq('user_id', userId).eq('machine_type', machineType).eq('status', 'confirmed'),
    ]);
    if ((ownedRows?.length ?? 0) > (confirmedRows?.length ?? 0)) {
      alreadyCredited = true;
    }
  } else {
    // For oil & slot: if metadata already contains tx data from a partial confirm
    const meta = purchase.metadata as Record<string, unknown> | null;
    if (meta && (meta.transaction_status || meta.transactionStatus)) {
      alreadyCredited = true;
    }
  }

  /* ── Credit the user ───────────────────────────────────────────── */
  if (!alreadyCredited) {
    try {
      if (type === 'oil') {
        const { data: state } = await admin
          .from('player_state')
          .select('oil_balance')
          .eq('user_id', purchase.user_id as string)
          .single();
        const newOil = Number(state?.oil_balance || 0) + Number(purchase.amount_oil || 0);
        const { error: oilErr } = await admin
          .from('player_state')
          .update({ oil_balance: newOil })
          .eq('user_id', purchase.user_id as string);
        if (oilErr) throw oilErr;

        // Referral bonus
        const { data: profile } = await admin
          .from('profiles')
          .select('referred_by, referral_bonus_paid')
          .eq('id', purchase.user_id as string)
          .single();
        if (profile?.referred_by && !profile.referral_bonus_paid) {
          const config = await getGameConfig();
          const bonusAmount = config.referrals?.bonus_diamonds ?? 0.5;
          const { data: refState } = await admin
            .from('player_state')
            .select('diamond_balance')
            .eq('user_id', profile.referred_by)
            .single();
          if (refState) {
            await admin.from('player_state')
              .update({ diamond_balance: Number(refState.diamond_balance) + bonusAmount })
              .eq('user_id', profile.referred_by);
            await admin.from('referral_bonuses').insert({
              referrer_id: profile.referred_by,
              referred_id: purchase.user_id as string,
              diamonds_awarded: bonusAmount,
            });
            await admin.from('profiles')
              .update({ referral_bonus_paid: true })
              .eq('id', purchase.user_id as string);
          }
        }
      } else if (type === 'machine') {
        const { error: machErr } = await admin.from('player_machines').insert({
          id: purchase.id as string,
          user_id: purchase.user_id as string,
          type: purchase.machine_type as string,
          level: 1,
          fuel_oil: 0,
          is_active: false,
          last_processed_at: null,
        });
        if (machErr) {
          const msg = machErr.message?.toLowerCase() || '';
          if (!(msg.includes('duplicate key') || msg.includes('already exists'))) {
            throw machErr;
          }
        }
      } else if (type === 'slot') {
        const slots = Number(purchase.slots_purchased ?? 0);
        const { error: slotErr } = await admin.rpc('increment_slots_for_purchase', {
          p_purchase_id: purchase.id as string,
          p_user_id: purchase.user_id as string,
          p_slots_add: slots,
        });
        if (slotErr) throw slotErr;
      }
    } catch (creditErr) {
      await logSecurityEvent({
        event_type: 'purchase_failed',
        user_id: purchase.user_id as string,
        severity: 'error',
        action: `cron_${type}_credit_failed`,
        details: { id, error: (creditErr as Error).message },
      }).catch(() => {});
      return { id, type, status: 'credit_error', credited: false, detail: (creditErr as Error).message };
    }
  }

  /* ── Mark confirmed ────────────────────────────────────────────── */
  const { error: updateErr } = await admin
    .from(table)
    .update({ status: 'confirmed', transaction_id: transactionId, metadata: tx })
    .eq('id', id);

  if (updateErr) {
    await logSecurityEvent({
      event_type: 'purchase_failed',
      user_id: purchase.user_id as string,
      severity: 'critical',
      action: `cron_${type}_status_update_failed`,
      details: { id, error: updateErr.message },
    }).catch(() => {});
    return { id, type, status: 'status_update_failed', credited: !alreadyCredited, detail: updateErr.message };
  }

  await logSecurityEvent({
    event_type: 'purchase_confirmed',
    user_id: purchase.user_id as string,
    severity: 'info',
    action: `cron_${type}_reconcile`,
    details: { reference: purchase.reference, id, already_credited: alreadyCredited },
  }).catch(() => {});

  return { id, type, status: 'confirmed', credited: !alreadyCredited };
}

/* ── Main handler ─────────────────────────────────────────────────── */

Deno.serve(async (req) => {
  // Accept GET (pg_net default) or POST
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 });
  }

  try {
    /* ── Auth: cron secret (custom header) OR service role key ── */
    const cronSecret = Deno.env.get('CRON_VERIFY_SECRET');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    // Check x-cron-key custom header (used by pg_cron / pg_net)
    const cronKeyHeader = req.headers.get('x-cron-key');
    // Check Authorization header (used by manual curl / service role calls)
    const authBearer = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');

    const isAuthorized =
      (cronSecret && (cronKeyHeader === cronSecret || authBearer === cronSecret)) ||
      (serviceRoleKey && authBearer === serviceRoleKey);

    if (!isAuthorized) {
      console.warn('[cron-verify-payments] Unauthorized attempt');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const appId = Deno.env.get('WORLD_APP_ID') || Deno.env.get('APP_ID');
    const apiKey = Deno.env.get('DEV_PORTAL_API_KEY') || Deno.env.get('WORLD_ID_API_KEY');
    if (!appId || !apiKey) throw new Error('Missing developer portal credentials');

    const admin = getAdminClient();
    const startTime = Date.now();

    /* ── 1. Verify pending purchases with transaction_ids ──────── */
    const [{ data: oilRows }, { data: machineRows }, { data: slotRows }] = await Promise.all([
      admin.from('oil_purchases').select('*').eq('status', 'pending').not('transaction_id', 'is', null).order('created_at').limit(100),
      admin.from('machine_purchases').select('*').eq('status', 'pending').not('transaction_id', 'is', null).order('created_at').limit(100),
      admin.from('slot_purchases').select('*').eq('status', 'pending').not('transaction_id', 'is', null).order('created_at').limit(100),
    ]);

    const results: Awaited<ReturnType<typeof verifyOneRow>>[] = [];

    for (const row of oilRows ?? []) {
      results.push(await verifyOneRow(admin, row, 'oil', appId, apiKey));
    }
    for (const row of machineRows ?? []) {
      results.push(await verifyOneRow(admin, row, 'machine', appId, apiKey));
    }
    for (const row of slotRows ?? []) {
      results.push(await verifyOneRow(admin, row, 'slot', appId, apiKey));
    }

    /* ── 2. Expire stale abandoned purchases (>24 h, no txid) ─── */
    // Process in small batches to avoid timeouts on large datasets.
    const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let totalExpired = 0;

    for (const t of ['oil_purchases', 'machine_purchases', 'slot_purchases'] as const) {
      // Fetch a batch of stale IDs, then update them by ID list
      const { data: staleRows } = await admin
        .from(t)
        .select('id')
        .eq('status', 'pending')
        .is('transaction_id', null)
        .lt('created_at', staleThreshold)
        .limit(500);

      if (staleRows && staleRows.length > 0) {
        const ids = staleRows.map((r: { id: string }) => r.id);
        await admin.from(t).update({
          status: 'failed',
          metadata: { reason: 'stale_pending_no_transaction_id' }
        }).in('id', ids);
        totalExpired += ids.length;
      }
    }

    /* ── 3. Summary ───────────────────────────────────────────── */
    const confirmed = results.filter(r => r.status === 'confirmed').length;
    const credited = results.filter(r => r.credited).length;
    const elapsed = Date.now() - startTime;

    const summary = {
      verified: results.length,
      confirmed,
      credited,
      failed: results.filter(r => ['tx_failed', 'credit_error', 'api_error', 'underpaid'].includes(r.status)).length,
      still_pending: results.filter(r => r.status.startsWith('pending_onchain')).length,
      expired_stale: totalExpired,
      elapsed_ms: elapsed,
    };

    if (results.length > 0 || totalExpired > 0) {
      await logSecurityEvent({
        event_type: 'admin_action',
        severity: 'info',
        action: 'cron_payment_verify',
        details: summary,
      }).catch(() => {});
    }

    console.log('[cron-verify-payments]', JSON.stringify(summary));

    return new Response(JSON.stringify({ ok: true, summary, results }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[cron-verify-payments] FATAL:', (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
