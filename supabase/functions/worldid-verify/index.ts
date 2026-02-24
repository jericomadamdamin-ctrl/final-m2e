import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, requireUserId } from '../_shared/supabase.ts';
import { verifyCloudProof } from 'https://esm.sh/@worldcoin/minikit-js@1.9.6';

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
    const { payload, action, signal } = await req.json();

    if (!payload || !action) {
      throw new Error('Missing verification data');
    }

    const appId = Deno.env.get('WORLD_APP_ID') || Deno.env.get('APP_ID');
    if (!appId) {
      throw new Error('Missing WORLD_APP_ID');
    }

    const verification = await verifyCloudProof(payload, appId, action, signal);
    if (!verification?.success) {
      throw new Error('Invalid World ID proof');
    }

    const admin = getAdminClient();

    const nullifierHash = payload.nullifier_hash;
    const verificationLevel = payload.verification_level || payload.credential_type || 'device';

    const { data: existing } = await admin
      .from('world_id_verifications')
      .select('user_id, nullifier_hash')
      .eq('nullifier_hash', nullifierHash)
      .single();

    if (existing && existing.user_id !== userId) {
      throw new Error('Nullifier already used by a different user');
    }

    if (!existing) {
      await admin
        .from('world_id_verifications')
        .insert({
          user_id: userId,
          action,
          nullifier_hash: nullifierHash,
          verification_level: verificationLevel,
        });
    }

    await admin
      .from('profiles')
      .update({ is_human_verified: true, human_verified_at: new Date().toISOString() })
      .eq('id', userId);

    return new Response(JSON.stringify({ ok: true, is_human_verified: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
