import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, requireUserId, requireAdmin, requireAdminOrKey } from '../_shared/supabase.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setByPath = (obj: any, path: string, value: any) => {
  const parts = path.split('.');
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (cursor[key] === undefined || cursor[key] === null) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
};

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
    await requireAdminOrKey(req, userId);

    const body = await req.json();
    const updates = body?.updates as Record<string, unknown> | undefined;

    if (!updates || typeof updates !== 'object') {
      throw new Error('Missing updates payload');
    }

    const admin = getAdminClient();
    const { data, error } = await admin
      .from('game_config')
      .select('value')
      .eq('key', 'current')
      .single();

    if (error || !data) {
      throw new Error('Config not found');
    }

    const nextConfig = { ...data.value };
    Object.entries(updates).forEach(([path, value]) => setByPath(nextConfig, path, value));

    const { error: updateError } = await admin
      .from('game_config')
      .update({ value: nextConfig, updated_by: userId })
      .eq('key', 'current');

    if (updateError) {
      throw updateError;
    }

    return new Response(JSON.stringify({ ok: true, config: nextConfig }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
