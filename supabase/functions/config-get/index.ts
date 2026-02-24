import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from('game_config')
      .select('value')
      .eq('key', 'current')
      .single();

    if (error || !data) {
      throw new Error('Config not found');
    }

    return new Response(JSON.stringify({ config: data.value }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
