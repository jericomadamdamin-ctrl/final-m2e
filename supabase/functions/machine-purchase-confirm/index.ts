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
        if (!payload?.reference || !payload?.transaction_id) {
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
            .from('machine_purchases')
            .select('*')
            .eq('reference', payload.reference)
            .eq('user_id', userId)
            .single();

        if (findError || !purchase) {
            throw new Error('Machine purchase not found');
        }

        if (purchase.status === 'confirmed') {
            return new Response(JSON.stringify({ ok: true, status: 'confirmed', message: 'Already confirmed' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Check slot limit again to prevent race conditions (initiating multiple buys)
        const { count: machineCount, error: countError } = await admin
            .from('player_machines')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);

        if (countError) throw new Error('Failed to verify slot limit');

        const { data: stateData } = await admin.from('player_state').select('purchased_slots').eq('user_id', userId).single();
        const { data: configData } = await admin.from('game_config').select('value').eq('key', 'current').single();

        const slotConfig = (configData?.value as any)?.slots ?? { base_slots: 10, max_total_slots: 30 };
        const purchasedSlots = Number(stateData?.purchased_slots ?? 0);
        const maxSlots = Math.min(slotConfig.base_slots + purchasedSlots, slotConfig.max_total_slots);

        if ((machineCount ?? 0) >= maxSlots) {
            throw new Error(`Slot limit reached (${machineCount}/${maxSlots}). Cannot award machine.`);
        }

        // Eagerly store transaction_id so the batch verifier can pick it up later
        if (payload.transaction_id && !purchase.transaction_id) {
            await admin
                .from('machine_purchases')
                .update({ transaction_id: payload.transaction_id })
                .eq('id', purchase.id)
                .eq('status', 'pending');
        }

        // Verify Transaction with Developer Portal
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
            // May not be stored for machines, rely on reference + amount
        }

        // Verify Amount — World API may return camelCase (inputTokenAmount) or nested input_token
        const rawAmount = tx?.input_token?.amount ?? tx?.inputTokenAmount;
        if (rawAmount) {
            let txAmount = parseFloat(rawAmount);
            if (txAmount > 1e9) txAmount = txAmount / 1e18; // raw wei → token units
            const expectedAmount = Number(purchase.amount_wld);
            // Allow 1% tolerance
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
                .from('machine_purchases')
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

        // Award machine first using purchase.id as deterministic machine id.
        // This makes retries idempotent if status update fails after crediting.
        let machine: any = null;
        const { data: insertedMachine, error: machineError } = await admin
            .from('player_machines')
            .insert({
                id: purchase.id,
                user_id: userId,
                type: purchase.machine_type,
                level: 1,
                fuel_oil: 0,
                is_active: false,
                last_processed_at: null,
            })
            .select('*')
            .single();

        if (machineError) {
            // If machine already exists for this purchase id, treat as already credited.
            const msg = machineError.message?.toLowerCase() || '';
            if (!(msg.includes('duplicate key') || msg.includes('already exists'))) {
                throw new Error('Failed to award machine: ' + machineError.message);
            }
            const { data: existingMachine, error: fetchMachineError } = await admin
                .from('player_machines')
                .select('*')
                .eq('id', purchase.id)
                .eq('user_id', userId)
                .maybeSingle();
            if (fetchMachineError || !existingMachine) {
                throw new Error('Machine credit state is inconsistent. Please contact support.');
            }
            machine = existingMachine;
        } else {
            machine = insertedMachine;
        }

        // Mark as confirmed only after successful credit.
        const { error: updateError } = await admin
            .from('machine_purchases')
            .update({ status: 'confirmed', transaction_id: payload.transaction_id, metadata: tx })
            .eq('id', purchase.id)
            .eq('status', 'pending');

        if (updateError) {
            throw new Error('Failed to confirm purchase record');
        }

        logSecurityEvent({
            event_type: 'purchase_confirmed',
            user_id: userId,
            severity: 'info',
            action: 'machine_purchase',
            details: { type: purchase.machine_type, amount: purchase.amount_wld, reference: payload.reference },
        });

        return new Response(JSON.stringify({
            ok: true,
            machine,
            message: `Congratulations! Your new ${purchase.machine_type} machine is ready.`,
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
