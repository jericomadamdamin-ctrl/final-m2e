import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, requireUserId, requireAdmin, requireHuman } from '../_shared/supabase.ts';
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
    const body = await req.json();
    const token = body?.token as string;
    const amountToken = Number(body?.amount_token || 0);
    const reference = body?.reference as string | undefined;
    const autoConfirm = Boolean(body?.auto_confirm);

    if (autoConfirm) {
      await requireAdmin(userId);
    }

    if (!token || !['WLD', 'USDC'].includes(token)) {
      throw new Error('Invalid token');
    }
    if (amountToken <= 0) {
      throw new Error('Invalid amount');
    }

    const config = await getGameConfig();
    const oilPerWld = config.pricing.oil_per_wld;
    const oilPerUsdc = config.pricing.oil_per_usdc;
    const usdcToWld = config.pricing.usdc_to_wld_rate ?? 1;

    const amountOil = token === 'WLD'
      ? amountToken * oilPerWld
      : amountToken * oilPerUsdc;

    const amountWld = token === 'WLD'
      ? amountToken
      : amountToken * usdcToWld;

    const admin = getAdminClient();
    const status = autoConfirm ? 'confirmed' : 'pending';

    const { data: purchase, error } = await admin
      .from('oil_purchases')
      .insert({
        user_id: userId,
        token,
        amount_token: amountToken,
        amount_oil: amountOil,
        amount_wld: amountWld,
        status,
        reference,
      })
      .select('*')
      .single();

    if (error || !purchase) throw new Error('Failed to create purchase');

    if (autoConfirm) {
      await ensurePlayerState(userId);
      const { data: state } = await admin
        .from('player_state')
        .select('oil_balance')
        .eq('user_id', userId)
        .single();

      const newOil = Number(state?.oil_balance || 0) + amountOil;
      await admin
        .from('player_state')
        .update({ oil_balance: newOil })
        .eq('user_id', userId);
    }

    return new Response(JSON.stringify({ ok: true, purchase }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
