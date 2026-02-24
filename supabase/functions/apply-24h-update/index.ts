import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const admin = createClient(supabaseUrl, supabaseServiceKey);

        const updates = [
            { id: 'mini', tank_capacity: 150 },
            { id: 'light', tank_capacity: 750 },
            { id: 'heavy', tank_capacity: 3000 },
            { id: 'mega', tank_capacity: 15000 },
        ];

        const results = [];

        // 1. Update machine_tiers
        for (const update of updates) {
            const { error } = await admin
                .from('machine_tiers')
                .update({ tank_capacity: update.tank_capacity })
                .eq('id', update.id);

            if (error) throw error;
            results.push(`Updated ${update.id} to ${update.tank_capacity}`);
        }

        // 2. Update game_config JSON
        const { data: configData, error: configError } = await admin
            .from('game_config')
            .select('value')
            .eq('key', 'current')
            .single();

        if (configError) throw configError;

        const config = configData.value;
        if (config.machines) {
            if (config.machines.mini) config.machines.mini.tank_capacity = 150;
            if (config.machines.light) config.machines.light.tank_capacity = 750;
            if (config.machines.heavy) config.machines.heavy.tank_capacity = 3000;
            if (config.machines.mega) config.machines.mega.tank_capacity = 15000;
        }

        const { error: updateError } = await admin
            .from('game_config')
            .update({ value: config })
            .eq('key', 'current');

        if (updateError) throw updateError;
        results.push('Updated game_config JSON');

        return new Response(JSON.stringify({ ok: true, results }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
