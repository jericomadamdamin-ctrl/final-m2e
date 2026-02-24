import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, requireUserId, requireHuman } from '../_shared/supabase.ts';
import { getGameConfig, ensurePlayerState } from '../_shared/mining.ts';

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

        const admin = getAdminClient();
        const config = await getGameConfig();
        const state = await ensurePlayerState(userId);

        // Get slot config with defaults
        const slotConfig = (config as any).slots ?? {
            base_slots: 10,
            slot_pack_size: 5,
            slot_pack_price_wld: 1,
            max_total_slots: 30,
        };

        const currentPurchased = Number((state as any).purchased_slots ?? 0);
        const currentMax = slotConfig.base_slots + currentPurchased;

        // Check if already at max
        if (currentMax >= slotConfig.max_total_slots) {
            throw new Error('Already at maximum slot capacity');
        }

        // Calculate how many slots can still be purchased
        const remainingSlots = slotConfig.max_total_slots - currentMax;
        const slotsToAdd = Math.min(slotConfig.slot_pack_size, remainingSlots);
        const priceWld = slotConfig.slot_pack_price_wld;

        // Get treasury address
        const treasuryAddress = Deno.env.get('TREASURY_ADDRESS') || (config as any)?.treasury?.treasury_address;
        if (!treasuryAddress) {
            throw new Error('Treasury address not configured');
        }

        // Prevent duplicate pending purchases (race-condition guard).
        const cutoff = new Date(Date.now() - 60_000).toISOString();
        const { data: existing } = await admin
            .from('slot_purchases')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'pending')
            .eq('slots_purchased', slotsToAdd)
            .gte('created_at', cutoff)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (existing) {
            return new Response(JSON.stringify({
                ok: true,
                reference: existing.reference,
                slots_to_add: slotsToAdd,
                amount_wld: priceWld,
                to_address: treasuryAddress,
                description: `Buy ${slotsToAdd} machine slots`,
                current_slots: currentMax,
                new_max_slots: currentMax + slotsToAdd,
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const reference = crypto.randomUUID();

        // Create pending purchase record
        const { data: purchase, error } = await admin
            .from('slot_purchases')
            .insert({
                user_id: userId,
                slots_purchased: slotsToAdd,
                amount_wld: priceWld,
                status: 'pending',
                reference,
            })
            .select('*')
            .single();

        if (error || !purchase) {
            throw new Error('Failed to create slot purchase');
        }

        return new Response(JSON.stringify({
            ok: true,
            reference,
            slots_to_add: slotsToAdd,
            amount_wld: priceWld,
            to_address: treasuryAddress,
            description: `Buy ${slotsToAdd} machine slots`,
            current_slots: currentMax,
            new_max_slots: currentMax + slotsToAdd,
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
