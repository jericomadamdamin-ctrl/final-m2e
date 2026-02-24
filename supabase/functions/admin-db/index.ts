
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, verifyAdmin, requireUserId } from '../_shared/supabase.ts';
import { logSecurityEvent, checkRateLimit, extractClientInfo } from '../_shared/security.ts';

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

        // Rate limit admin mutations to reduce blast radius
        const rate = await checkRateLimit(userId, 'admin_db', 30, 1);
        if (!rate.allowed) {
            throw new Error('Admin rate limit exceeded. Try again in a minute.');
        }

        const { table, action, id, updates } = await req.json();

        const allowedTables = ['machine_tiers', 'mineral_configs', 'global_game_settings', 'profiles', 'player_state', 'player_flags', 'oil_purchases', 'machine_purchases', 'slot_purchases', 'cashout_requests', 'cashout_rounds', 'cashout_payouts'];
        if (!table || !allowedTables.includes(table)) {
            throw new Error('Invalid or unauthorized table');
        }

        if (action === 'update' && (table === 'cashout_requests' || table === 'cashout_rounds')) {
            throw new Error('Direct cashout status updates are disabled. Use cashout command endpoints.');
        }

        const admin = getAdminClient();
        let result;

        const allowFields: Record<string, string[]> = {
            machine_tiers: ['cost_oil', 'cost_wld', 'speed_actions_per_hour', 'oil_burn_per_hour', 'tank_capacity', 'max_level', 'is_enabled', 'name', 'image_url'],
            mineral_configs: ['oil_value', 'drop_rate', 'name'],
            global_game_settings: ['value', 'description'],
            profiles: ['player_name', 'is_admin', 'is_human_verified', 'wallet_address', 'referral_code', 'referral_bonus_paid'],
            player_state: ['oil_balance', 'diamond_balance', 'minerals', 'purchased_slots'],
            player_flags: ['is_shadow_banned', 'shadow_ban_reason', 'shadow_ban_at'],
            oil_purchases: ['status', 'metadata'],
            machine_purchases: ['status', 'metadata'],
            slot_purchases: ['status', 'metadata'],
            // Cashout request/round lifecycle is command-driven and must not be mutated directly.
            cashout_requests: [],
            cashout_rounds: [],
            cashout_payouts: ['status', 'tx_hash', 'metadata'],
        };

        const sanitizeUpdates = (tableName: string, payload: Record<string, unknown>) => {
            const allowed = allowFields[tableName] || [];
            const filtered: Record<string, unknown> = {};
            for (const key of Object.keys(payload || {})) {
                if (!allowed.includes(key)) continue;
                filtered[key] = payload[key];
            }
            if (Object.keys(filtered).length === 0) {
                throw new Error('No allowable fields in update');
            }
            // Basic non-negative guard for balances/values
            for (const [k, v] of Object.entries(filtered)) {
                if (typeof v === 'number' && ['oil_balance', 'diamond_balance', 'value', 'cost_oil', 'cost_wld', 'speed_actions_per_hour', 'oil_burn_per_hour', 'tank_capacity', 'max_level', 'oil_value', 'drop_rate', 'purchased_slots'].includes(k)) {
                    if (!Number.isFinite(v) || v < 0) {
                        throw new Error(`Invalid value for ${k}`);
                    }
                }
            }
            return filtered;
        };

        if (action === 'update' && (id || updates?.key)) {
            // Special case: player_flags uses user_id as PK; use upsert to create row if missing
            if (table === 'player_flags') {
                const userId = id || updates.key;
                const safeUpdates = sanitizeUpdates(table, updates || {});
                const { data, error } = await admin
                    .from(table)
                    .upsert({ user_id: userId, ...safeUpdates }, { onConflict: 'user_id' })
                    .select()
                    .single();
                if (error) throw error;
                result = data;
            } else {
                const pk = table === 'global_game_settings' ? 'key' : 'id';
                const safeUpdates = sanitizeUpdates(table, updates || {});
                const { data, error } = await admin
                    .from(table)
                    .update(safeUpdates)
                    .eq(pk, id || updates.key)
                    .select()
                    .single();
                if (error) throw error;
                result = data;
            }
        } else if (action === 'fetch') {
            const { data, error } = await admin
                .from(table)
                .select('*');
            if (error) throw error;
            result = data;
        } else {
            throw new Error('Invalid action');
        }

        return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

    } catch (err) {
        // Best-effort audit
        try {
            await logSecurityEvent({
                event_type: 'admin_action',
                severity: 'warning',
                action: 'admin-db',
                details: { error: (err as Error).message },
                ...extractClientInfo(req),
            });
        } catch { /* ignore */ }
        return new Response(JSON.stringify({ error: (err as Error).message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
