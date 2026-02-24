import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, requireUserId, requireHuman } from '../_shared/supabase.ts';

import { logSecurityEvent, extractClientInfo } from '../_shared/security.ts';

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
        // Fallback for old requests (though we are fixing it now)
        const reference = payload?.reference;

        if (!reference || !payload?.transaction_id) {
            throw new Error('Missing payment payload');
        }

        const appId = Deno.env.get('WORLD_APP_ID') || Deno.env.get('APP_ID');
        const apiKey = Deno.env.get('DEV_PORTAL_API_KEY') || Deno.env.get('WORLD_ID_API_KEY');
        if (!appId || !apiKey) {
            throw new Error('Missing developer portal credentials');
        }

        const admin = getAdminClient();

        // Find pending purchase
        const { data: purchase, error: findError } = await admin
            .from('slot_purchases')
            .select('*')
            .eq('reference', reference)
            .eq('user_id', userId)
            .single();

        if (findError || !purchase) {
            throw new Error('Slot purchase not found');
        }

        if (purchase.status === 'confirmed') {
            return new Response(JSON.stringify({ ok: true, status: 'confirmed', message: 'Already confirmed' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Verify slot limit to prevent race condition over-purchasing
        const { data: stateData } = await admin.from('player_state').select('purchased_slots').eq('user_id', userId).single();
        const { data: configData } = await admin.from('game_config').select('value').eq('key', 'current').single();

        const slotConfig = (configData?.value as any)?.slots ?? { base_slots: 10, max_total_slots: 30 };
        const purchasedSlots = Number(stateData?.purchased_slots ?? 0);
        const slotsToAdd = Number(purchase.slots_purchased);

        if (slotConfig.base_slots + purchasedSlots + slotsToAdd > slotConfig.max_total_slots) {
            throw new Error(`Slot limit exceeded. Max total slots: ${slotConfig.max_total_slots}`);
        }

        // Eagerly store transaction_id so the batch verifier can pick it up later
        if (payload.transaction_id && !purchase.transaction_id) {
            await admin
                .from('slot_purchases')
                .update({ transaction_id: payload.transaction_id })
                .eq('id', purchase.id)
                .eq('status', 'pending');
        }

        // Verify Transaction
        const verifyRes = await fetch(`${DEV_PORTAL_API}/${payload.transaction_id}?app_id=${appId}&type=payment`, {
            headers: { Authorization: `Bearer ${apiKey}` },
        });

        if (!verifyRes.ok) {
            throw new Error('Failed to verify transaction');
        }

        const tx = await verifyRes.json();

        const txRef = tx?.reference;
        if (txRef && txRef !== reference) {
            throw new Error('Reference mismatch');
        }

        // Validation: Amount — World API may return camelCase or nested
        const rawAmount = tx?.input_token?.amount ?? tx?.inputTokenAmount;
        if (rawAmount) {
            let txAmount = parseFloat(rawAmount);
            if (txAmount > 1e9) txAmount = txAmount / 1e18; // raw wei → token units
            const expectedAmount = Number(purchase.amount_wld);
            if (txAmount < expectedAmount * 0.99) {
                const clientInfo = extractClientInfo(req);
                logSecurityEvent({
                    event_type: 'suspicious_activity',
                    user_id: userId,
                    severity: 'critical',
                    action: 'underpayment_attempt',
                    details: { expected: expectedAmount, received: txAmount, reference },
                    ...clientInfo,
                });
                throw new Error('Transaction amount mismatch');
            }
        }

        const txStatus = tx?.transaction_status ?? tx?.transactionStatus;
        if (txStatus === 'failed') {
            await admin
                .from('slot_purchases')
                .update({ status: 'failed' })
                .eq('id', purchase.id);
            throw new Error('Transaction failed on-chain');
        }

        const status = txStatus;
        const minedStatuses = ['mined', 'completed', 'confirmed', 'success'];

        if (status && !minedStatuses.includes(status)) {
            return new Response(JSON.stringify({ ok: true, status: txStatus }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Credit slots first via idempotent RPC keyed by purchase id.
        const { error: stateError } = await admin.rpc('increment_slots_for_purchase', {
            p_purchase_id: purchase.id,
            p_user_id: userId,
            p_slots_add: purchase.slots_purchased,
        });

        if (stateError) {
            console.error('RPC Error:', stateError);
            throw new Error(`Failed to update player state: ${stateError.message}`);
        }

        // Mark as confirmed only after successful credit.
        const { error: updateError } = await admin
            .from('slot_purchases')
            .update({ status: 'confirmed', transaction_id: payload.transaction_id, metadata: tx })
            .eq('id', purchase.id)
            .eq('status', 'pending');

        if (updateError) {
            throw new Error('Failed to confirm purchase');
        }

        logSecurityEvent({
            event_type: 'purchase_confirmed',
            user_id: userId,
            severity: 'info',
            action: 'slot_purchase',
            details: { slots: purchase.slots_purchased, amount: purchase.amount_wld, reference },
        });

        return new Response(JSON.stringify({
            ok: true,
            slots_added: purchase.slots_purchased,
            message: `Successfully added ${purchase.slots_purchased} machine slots!`,
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
