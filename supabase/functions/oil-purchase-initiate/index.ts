import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, requireUserId, requireHuman } from '../_shared/supabase.ts';
import { getGameConfig } from '../_shared/mining.ts';

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

    const { token, oil_amount } = await req.json();
    const tokenSymbol = token as string;
    const oilAmount = Number(oil_amount || 0);

    if (!tokenSymbol || !['WLD', 'USDC'].includes(tokenSymbol)) {
      throw new Error('Invalid token');
    }
    if (isNaN(oilAmount) || !Number.isFinite(oilAmount) || oilAmount <= 0) {
      throw new Error('Invalid OIL amount');
    }
    if (oilAmount > 1000000) {
      throw new Error('Maximum OIL purchase is 1,000,000');
    }

    const config = await getGameConfig();
    const oilPerWld = config.pricing.oil_per_wld;
    const oilPerUsdc = config.pricing.oil_per_usdc;
    const usdcToWld = config.pricing.usdc_to_wld_rate ?? 1;

    const amountToken = tokenSymbol === 'WLD'
      ? oilAmount / oilPerWld
      : oilAmount / oilPerUsdc;

    const amountWld = tokenSymbol === 'WLD'
      ? amountToken
      : amountToken * usdcToWld;

    const treasuryAddress = Deno.env.get('TREASURY_ADDRESS') || config?.treasury?.treasury_address;
    if (!treasuryAddress) {
      throw new Error('Treasury address not configured');
    }

    const admin = getAdminClient();

    // Prevent duplicate pending purchases (race-condition guard).
    // If the user already has a pending oil purchase created in the last 60 s
    // with the same amount, reuse it instead of creating another row.
    const cutoff = new Date(Date.now() - 60_000).toISOString();
    const { data: existing } = await admin
      .from('oil_purchases')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .eq('amount_oil', oilAmount)
      .eq('token', tokenSymbol)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({
        ok: true,
        reference: existing.reference,
        token: tokenSymbol,
        amount_token: amountToken,
        amount_oil: oilAmount,
        to_address: treasuryAddress,
        description: `Buy ${oilAmount} OIL`,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const reference = crypto.randomUUID();

    const { data: purchase, error } = await admin
      .from('oil_purchases')
      .insert({
        user_id: userId,
        token: tokenSymbol,
        amount_token: amountToken,
        amount_oil: oilAmount,
        amount_wld: amountWld,
        status: 'pending',
        reference,
        to_address: treasuryAddress,
      })
      .select('*')
      .single();

    if (error || !purchase) {
      throw new Error('Failed to create purchase');
    }

    return new Response(JSON.stringify({
      ok: true,
      reference,
      token: tokenSymbol,
      amount_token: amountToken,
      amount_oil: oilAmount,
      to_address: treasuryAddress,
      description: `Buy ${oilAmount} OIL`,
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
