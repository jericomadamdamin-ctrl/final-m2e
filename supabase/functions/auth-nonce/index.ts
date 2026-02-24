import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const admin = getAdminClient();
    const { error } = await admin
      .from('auth_nonces')
      .insert({ nonce, expires_at: expiresAt });

    if (error) throw error;

    return new Response(JSON.stringify({ nonce, expires_at: expiresAt }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
