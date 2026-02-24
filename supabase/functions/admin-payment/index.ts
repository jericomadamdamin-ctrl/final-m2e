
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, verifyAdmin, requireUserId } from '../_shared/supabase.ts';
import { getGameConfig } from '../_shared/mining.ts';
import { logSecurityEvent, extractClientInfo, checkRateLimit } from '../_shared/security.ts';

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
        await verifyAdmin(req);

        const rate = await checkRateLimit(userId, 'admin_payment', 20, 1);
        if (!rate.allowed) {
            throw new Error('Admin rate limit exceeded. Try again in a minute.');
        }

        const { action, type, id } = await req.json();
        const admin = getAdminClient();

        if (action === 'fetch_pending') {
            // Fetch pending oil purchases
            const { data: oilPurchases, error: oilError } = await admin
                .from('oil_purchases')
                .select('*, profiles(player_name, wallet_address)')
                .eq('status', 'pending')
                .order('created_at', { ascending: false });

            if (oilError) throw oilError;

            // Fetch pending machine purchases
            const { data: machinePurchases, error: machineError } = await admin
                .from('machine_purchases')
                .select('*, profiles(player_name, wallet_address)')
                .eq('status', 'pending')
                .order('created_at', { ascending: false });

            if (machineError) throw machineError;

            const { data: slotPurchases, error: slotError } = await admin
                .from('slot_purchases')
                .select('*, profiles(player_name, wallet_address)')
                .eq('status', 'pending')
                .order('created_at', { ascending: false });

            if (slotError) throw slotError;

            return new Response(JSON.stringify({
                oil: oilPurchases,
                machines: machinePurchases,
                slots: slotPurchases
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        if (action === 'verify' || action === 'reject') {
            if (!id || !type) throw new Error('Missing id or type');

            const table = type === 'oil' ? 'oil_purchases' : type === 'machine' ? 'machine_purchases' : 'slot_purchases';

            // Load purchase once for both paths
            const { data: purchase, error: fetchError } = await admin
                .from(table)
                .select('*')
                .eq('id', id)
                .single();

            if (fetchError || !purchase) throw new Error('Purchase not found');
            if (purchase.status !== 'pending') throw new Error('Purchase is not pending');

            if (action === 'reject') {
                const { error } = await admin
                    .from(table)
                    .update({ status: 'failed', metadata: { reason: 'Admin rejected' } })
                    .eq('id', id);
                if (error) throw error;
                const clientInfo = extractClientInfo(req);
                logSecurityEvent({
                    event_type: 'admin_action',
                    severity: 'info',
                    action: 'admin_reject',
                    details: { type, id, user_id: purchase.user_id },
                    ...clientInfo,
                }).catch(() => {});
                return new Response(JSON.stringify({ ok: true }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }

            // Verify Logic
            // 1. Mark purchase as confirmed
            // 2. Grant rewards
            if (type === 'oil') {
                const { data: state } = await admin
                    .from('player_state')
                    .select('oil_balance')
                    .eq('user_id', purchase.user_id)
                    .single();

                const newOil = Number(state?.oil_balance || 0) + Number(purchase.amount_oil);

                await admin.from('player_state').update({ oil_balance: newOil }).eq('user_id', purchase.user_id);

                // Referral bonus check (simplified from oil-purchase-confirm)
                const { data: profile } = await admin.from('profiles').select('referred_by, referral_bonus_paid').eq('id', purchase.user_id).single();
                if (profile?.referred_by && !profile.referral_bonus_paid) {
                    const config = await getGameConfig();
                    const bonusAmount = config.referrals?.bonus_diamonds ?? 0.5;

                    // Get referrer state
                    const { data: refState } = await admin.from('player_state').select('diamond_balance').eq('user_id', profile.referred_by).single();
                    if (refState) {
                        await admin.from('player_state').update({ diamond_balance: refState.diamond_balance + bonusAmount }).eq('user_id', profile.referred_by);
                        await admin.from('referral_bonuses').insert({
                            referrer_id: profile.referred_by,
                            referred_id: purchase.user_id,
                            diamonds_awarded: bonusAmount
                        });
                        await admin.from('profiles').update({ referral_bonus_paid: true }).eq('id', purchase.user_id);
                    }
                }

            } else if (type === 'machine') {
                // Manual admin override — no World API call, so no tx amount check.
                // Grant machine into player_machines (game uses this table)
                const { error: machineInsertError } = await admin.from('player_machines').insert({
                    id: purchase.id,
                    user_id: purchase.user_id,
                    type: purchase.machine_type,
                    level: 1,
                    fuel_oil: 0,
                    is_active: false,
                    last_processed_at: null
                });
                if (machineInsertError) {
                    const msg = machineInsertError.message?.toLowerCase() || '';
                    if (!(msg.includes('duplicate key') || msg.includes('already exists'))) {
                        throw machineInsertError;
                    }
                }

            } else if (type === 'slot') {
                // Manual admin override — no World API call, so no tx amount check.
                // Increment purchased_slots using idempotent purchase-keyed RPC.
                const { error: slotError } = await admin.rpc('increment_slots_for_purchase', {
                    p_purchase_id: purchase.id,
                    p_user_id: purchase.user_id,
                    p_slots_add: purchase.slots_purchased ?? 0,
                });
                if (slotError) throw slotError;
            }

            // 3. Update status
            const { error: updateError } = await admin
                .from(table)
                .update({ status: 'confirmed', metadata: { method: 'admin_manual_verify' } })
                .eq('id', id);

            if (updateError) throw updateError;

            const clientInfo = extractClientInfo(req);
            logSecurityEvent({
                event_type: 'admin_action',
                user_id: purchase.user_id,
                severity: 'info',
                action: 'admin_verify',
                details: { type, id },
                ...clientInfo,
            }).catch(() => {});

            return new Response(JSON.stringify({ ok: true }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        throw new Error('Invalid action');

    } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
