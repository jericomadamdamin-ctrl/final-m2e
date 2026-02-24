import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, requireUserId, verifyAdmin } from '../_shared/supabase.ts';
import { logSecurityEvent, extractClientInfo } from '../_shared/security.ts';
import { getGameConfig } from '../_shared/mining.ts';

/* ── World App Dev Portal ───────────────────────────────────────── */
const DEV_PORTAL_API = 'https://developer.worldcoin.org/api/v2/minikit/transaction';
const SUCCESS_STATUSES = ['mined', 'completed', 'confirmed', 'success'];

/* ── Helpers ─────────────────────────────────────────────────────── */

/** Throws if actual < expected * 0.99 (1 % tolerance). */
const assertAmount = (expected: number, actual: number) => {
  if (!Number.isFinite(expected) || !Number.isFinite(actual)) {
    throw new Error('Invalid amount for verification');
  }
  if (actual < expected * 0.99) {
    throw new Error(`Transaction amount mismatch: expected ${expected}, got ${actual}`);
  }
};

type PurchaseType = 'oil' | 'machine' | 'slot';

const tableFor = (type: PurchaseType) =>
  type === 'oil' ? 'oil_purchases'
    : type === 'machine' ? 'machine_purchases'
    : 'slot_purchases';

/* ── Per-row verifier (shared by single + batch) ────────────────── */

interface VerifyResult {
  id: string;
  type: PurchaseType;
  status: string;
  credited: boolean;
  detail?: string;
}

async function verifyOneRow(
  admin: ReturnType<typeof getAdminClient>,
  purchase: Record<string, unknown>,
  type: PurchaseType,
  appId: string,
  apiKey: string,
  clientInfo: { ip_address?: string; user_agent?: string },
): Promise<VerifyResult> {
  const table = tableFor(type);
  const id = purchase.id as string;
  const transactionId = purchase.transaction_id as string | undefined;

  /* ── 1. Double-credit guard ─────────────────────────────────── */
  if (purchase.status === 'confirmed') {
    return { id, type, status: 'already_confirmed', credited: false };
  }
  if (purchase.status === 'failed') {
    return { id, type, status: 'already_failed', credited: false };
  }
  if (!transactionId) {
    return { id, type, status: 'skipped_no_txid', credited: false, detail: 'No transaction_id on row' };
  }

  /* ── 2. Verify with World Dev Portal ────────────────────────── */
  const verifyRes = await fetch(
    `${DEV_PORTAL_API}/${transactionId}?app_id=${appId}&type=payment`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!verifyRes.ok) {
    const text = await verifyRes.text().catch(() => '');
    return { id, type, status: 'api_error', credited: false, detail: `World API ${verifyRes.status}: ${text}` };
  }
  const tx = await verifyRes.json();

  /* ── 3. Reference match ─────────────────────────────────────── */
  const txRef = tx?.reference;
  if (txRef && purchase.reference && txRef !== purchase.reference) {
    return { id, type, status: 'reference_mismatch', credited: false, detail: `tx.ref=${txRef} vs db.ref=${purchase.reference}` };
  }

  /* ── 4. Amount validation (±1 %) ────────────────────────────── */
  // World API may return camelCase (inputToken / inputTokenAmount) or nested input_token
  const rawAmount = tx?.input_token?.amount ?? tx?.inputTokenAmount;
  if (rawAmount) {
    // inputTokenAmount is in raw wei (18 decimals for WLD/USDC), convert if needed
    let txAmount = parseFloat(rawAmount);
    if (txAmount > 1e9) txAmount = txAmount / 1e18; // raw wei → token units
    const expected = Number(purchase.amount_token ?? purchase.amount_wld);
    try {
      assertAmount(expected, txAmount);
    } catch (e) {
      // Log suspicious underpayment but don't crash the batch
      logSecurityEvent({
        event_type: 'suspicious_activity',
        user_id: purchase.user_id as string,
        severity: 'critical',
        action: 'underpayment_attempt',
        details: { expected, received: txAmount, reference: purchase.reference, type },
        ...clientInfo,
      }).catch(() => {});
      return { id, type, status: 'amount_mismatch', credited: false, detail: (e as Error).message };
    }
  }

  /* ── 5. Transaction status gate ─────────────────────────────── */
  // World API may return camelCase (transactionStatus) or snake_case (transaction_status)
  const txStatus = tx?.transaction_status ?? tx?.transactionStatus;

  if (txStatus === 'failed') {
    await admin.from(table).update({ status: 'failed', metadata: tx }).eq('id', id);
    return { id, type, status: 'tx_failed', credited: false };
  }

  if (txStatus && !SUCCESS_STATUSES.includes(txStatus)) {
    // Still pending on-chain — leave row untouched for the next sweep
    return { id, type, status: `pending_onchain_${txStatus}`, credited: false };
  }

  /* ── 6. Detect if user was ALREADY credited ─────────────────── */
  let alreadyCredited = false;

  if (type === 'machine') {
    // A machine insert is the definitive proof of crediting.
    // Count machines of this type owned vs confirmed purchases of this type.
    const machineType = purchase.machine_type as string;
    const userId = purchase.user_id as string;

    const [{ data: ownedRows }, { data: confirmedRows }] = await Promise.all([
      admin.from('player_machines').select('id').eq('user_id', userId).eq('type', machineType),
      admin.from('machine_purchases').select('id').eq('user_id', userId).eq('machine_type', machineType).eq('status', 'confirmed'),
    ]);

    const ownedCount = ownedRows?.length ?? 0;
    const confirmedCount = confirmedRows?.length ?? 0;

    // If user owns more machines of this type than they have confirmed purchases for,
    // then this purchase was already credited by the user-facing confirm function.
    if (ownedCount > confirmedCount) {
      alreadyCredited = true;
    }
  } else if (type === 'oil') {
    // For oil we check the metadata on the row itself. The user-facing confirm writes
    // `metadata: tx` on the same UPDATE that sets status='confirmed'. If a partial crash
    // left status='pending' but metadata was written, it means the confirm reached the
    // credit step (credit happens BEFORE status update in oil-purchase-confirm).
    if (purchase.metadata && typeof purchase.metadata === 'object' && (purchase.metadata as Record<string, unknown>).transaction_status) {
      alreadyCredited = true;
    }
  } else if (type === 'slot') {
    // Similar heuristic: if metadata is populated from a prior confirm attempt,
    // the increment_slots RPC was likely already called.
    if (purchase.metadata && typeof purchase.metadata === 'object' && (purchase.metadata as Record<string, unknown>).transaction_status) {
      alreadyCredited = true;
    }
  }

  /* ── 7. Credit the user (if not already done) ───────────────── */
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

        // Referral bonus (same logic as oil-purchase-confirm)
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
      // Credit failed — do NOT mark as confirmed. Leave pending for retry.
      logSecurityEvent({
        event_type: 'purchase_failed',
        user_id: purchase.user_id as string,
        severity: 'error',
        action: `${type}_credit_failed`,
        details: { id, error: (creditErr as Error).message },
        ...clientInfo,
      }).catch(() => {});
      return { id, type, status: 'credit_error', credited: false, detail: (creditErr as Error).message };
    }
  }

  /* ── 8. Mark purchase as confirmed ──────────────────────────── */
  const { error: updateErr } = await admin
    .from(table)
    .update({ status: 'confirmed', transaction_id: transactionId, metadata: tx })
    .eq('id', id);

  if (updateErr) {
    // Edge case: credit succeeded but status update failed.
    // Log for manual intervention — we do NOT revert the credit.
    logSecurityEvent({
      event_type: 'purchase_failed',
      user_id: purchase.user_id as string,
      severity: 'critical',
      action: `${type}_status_update_failed_after_credit`,
      details: { id, error: updateErr.message },
      ...clientInfo,
    }).catch(() => {});
    return { id, type, status: 'status_update_failed', credited: !alreadyCredited, detail: updateErr.message };
  }

  /* ── 9. Security log ────────────────────────────────────────── */
  logSecurityEvent({
    event_type: 'purchase_confirmed',
    user_id: purchase.user_id as string,
    severity: 'info',
    action: `${type}_purchase_reconcile`,
    details: { reference: purchase.reference, id, already_credited: alreadyCredited },
    ...clientInfo,
  }).catch(() => {});

  return { id, type, status: 'confirmed', credited: !alreadyCredited };
}

/* ── Main handler ────────────────────────────────────────────────── */

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

    await requireUserId(req);
    await verifyAdmin(req);

    const appId = Deno.env.get('WORLD_APP_ID') || Deno.env.get('APP_ID');
    const apiKey = Deno.env.get('DEV_PORTAL_API_KEY') || Deno.env.get('WORLD_ID_API_KEY');
    if (!appId || !apiKey) throw new Error('Missing developer portal credentials');

    const admin = getAdminClient();
    const clientInfo = extractClientInfo(req);

    const body = await req.json();
    const action = body.action ?? 'verify_one'; // default for backward compat

    /* ── verify_one: single-row verification (backward compat) ── */
    if (action === 'verify_one') {
      const { type, id, transaction_id } = body;
      if (!type || !id) throw new Error('Missing type or id');

      const table = tableFor(type as PurchaseType);

      // If transaction_id was provided in the request, eagerly store it
      if (transaction_id) {
        await admin.from(table)
          .update({ transaction_id })
          .eq('id', id)
          .eq('status', 'pending')
          .is('transaction_id', null);
      }

      const { data: purchase } = await admin.from(table).select('*').eq('id', id).single();
      if (!purchase) throw new Error('Purchase not found');

      // If no transaction_id on the row and none provided, we can't verify
      if (!purchase.transaction_id && !transaction_id) {
        throw new Error('No transaction_id available — provide it in the request body or ensure the user called the confirm endpoint');
      }

      // Use the stored one (possibly just updated)
      if (transaction_id && !purchase.transaction_id) {
        purchase.transaction_id = transaction_id;
      }

      const result = await verifyOneRow(admin, purchase, type as PurchaseType, appId, apiKey, clientInfo);
      return new Response(JSON.stringify({ ok: true, result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    /* ── verify_all: batch verification of ALL pending rows ───── */
    if (action === 'verify_all') {
      const results: VerifyResult[] = [];

      // Fetch all pending purchases that have a transaction_id stored
      const [{ data: oilRows }, { data: machineRows }, { data: slotRows }] = await Promise.all([
        admin.from('oil_purchases').select('*').eq('status', 'pending').not('transaction_id', 'is', null).order('created_at'),
        admin.from('machine_purchases').select('*').eq('status', 'pending').not('transaction_id', 'is', null).order('created_at'),
        admin.from('slot_purchases').select('*').eq('status', 'pending').not('transaction_id', 'is', null).order('created_at'),
      ]);

      // Process sequentially to avoid overwhelming the World API
      for (const row of oilRows ?? []) {
        try {
          results.push(await verifyOneRow(admin, row, 'oil', appId, apiKey, clientInfo));
        } catch (err) {
          results.push({ id: row.id, type: 'oil', status: 'error', credited: false, detail: (err as Error).message });
        }
      }
      for (const row of machineRows ?? []) {
        try {
          results.push(await verifyOneRow(admin, row, 'machine', appId, apiKey, clientInfo));
        } catch (err) {
          results.push({ id: row.id, type: 'machine', status: 'error', credited: false, detail: (err as Error).message });
        }
      }
      for (const row of slotRows ?? []) {
        try {
          results.push(await verifyOneRow(admin, row, 'slot', appId, apiKey, clientInfo));
        } catch (err) {
          results.push({ id: row.id, type: 'slot', status: 'error', credited: false, detail: (err as Error).message });
        }
      }

      const confirmed = results.filter(r => r.status === 'confirmed').length;
      const credited = results.filter(r => r.credited).length;
      const skipped = results.filter(r => r.status.startsWith('already_') || r.status === 'skipped_no_txid').length;
      const failed = results.filter(r => ['error', 'credit_error', 'tx_failed', 'amount_mismatch', 'reference_mismatch', 'api_error'].includes(r.status)).length;

      logSecurityEvent({
        event_type: 'admin_action',
        severity: 'info',
        action: 'batch_payment_verify',
        details: { total: results.length, confirmed, credited, skipped, failed },
        ...clientInfo,
      }).catch(() => {});

      return new Response(JSON.stringify({
        ok: true,
        summary: { total: results.length, confirmed, credited, skipped, failed },
        results,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Invalid action: ${action}`);

  } catch (err) {
    const clientInfo = extractClientInfo(req);
    logSecurityEvent({
      event_type: 'purchase_failed',
      severity: 'warning',
      action: 'admin_payment_verify',
      details: { error: (err as Error).message },
      ...clientInfo,
    }).catch(() => {});
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
