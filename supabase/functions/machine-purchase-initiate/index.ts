import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, requireUserId, requireHuman } from '../_shared/supabase.ts';
import { getGameConfig, ensurePlayerState, getPlayerMachines } from '../_shared/mining.ts';

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

        const { machineType } = await req.json();
        if (!machineType) {
            throw new Error('Missing machineType');
        }

        const admin = getAdminClient();
        const config = await getGameConfig();
        const state = await ensurePlayerState(userId);
        const machines = await getPlayerMachines(userId);

        const machineConfig = config.machines[machineType];
        if (!machineConfig) {
            throw new Error('Invalid machine type');
        }

        if (!machineConfig.cost_wld || machineConfig.cost_wld <= 0) {
            throw new Error('Machine price not configured in WLD');
        }

        // Check slot limit
        const slotConfig = (config as any).slots ?? { base_slots: 10, max_total_slots: 30 };
        const purchasedSlots = Number((state as any).purchased_slots ?? 0);
        const maxSlots = Math.min(slotConfig.base_slots + purchasedSlots, slotConfig.max_total_slots);

        if (machines.length >= maxSlots) {
            throw new Error(`Machine slot limit reached (${machines.length}/${maxSlots}). Purchase more slots to continue.`);
        }

        // Get treasury address
        const treasuryAddress = Deno.env.get('TREASURY_ADDRESS') || (config as any)?.treasury?.treasury_address;
        if (!treasuryAddress) {
            throw new Error('Treasury address not configured');
        }

        // Prevent duplicate pending purchases (race-condition guard).
        const cutoff = new Date(Date.now() - 60_000).toISOString();
        const { data: existing } = await admin
            .from('machine_purchases')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'pending')
            .eq('machine_type', machineType)
            .gte('created_at', cutoff)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (existing) {
            return new Response(JSON.stringify({
                ok: true,
                reference: existing.reference,
                machine_type: machineType,
                amount_wld: machineConfig.cost_wld,
                to_address: treasuryAddress,
                description: `Buy ${machineConfig.name || machineType} machine`,
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const reference = crypto.randomUUID();

        // Create pending purchase record
        const { data: purchase, error } = await admin
            .from('machine_purchases')
            .insert({
                user_id: userId,
                machine_type: machineType,
                amount_wld: machineConfig.cost_wld,
                status: 'pending',
                reference,
            })
            .select('*')
            .single();

        if (error || !purchase) {
            throw new Error('Failed to create machine purchase record');
        }

        return new Response(JSON.stringify({
            ok: true,
            reference,
            machine_type: machineType,
            amount_wld: machineConfig.cost_wld,
            to_address: treasuryAddress,
            description: `Buy ${machineConfig.name || machineType} machine`,
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
