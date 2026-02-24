import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, requireUserId } from '../_shared/supabase.ts';
import { getGameConfig, processMining } from '../_shared/mining.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const userId = await requireUserId(req);

    const config = await getGameConfig();
    // Ensure state exists and process mining before returning state
    const { state, machines } = await processMining(userId, { config });

    const admin = getAdminClient();
    const { data: profile } = await admin
      .from('profiles')
      .select('player_name, is_admin, is_human_verified, wallet_address, referral_code')
      .eq('id', userId)
      .maybeSingle();

    // Count successful referrals
    const { count: referralCount } = await admin
      .from('referral_bonuses')
      .select('*', { count: 'exact', head: true })
      .eq('referrer_id', userId);

    const { data: lastCashoutRequest } = await admin
      .from('cashout_requests')
      .select('requested_at')
      .eq('user_id', userId)
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Calculate slot info
    const slotConfig = (config as any).slots ?? { base_slots: 10, max_total_slots: 30 };
    const purchasedSlots = Number((state as any).purchased_slots ?? 0);
    const maxSlots = Math.min(slotConfig.base_slots + purchasedSlots, slotConfig.max_total_slots);

    return new Response(JSON.stringify({
      ok: true,
      config,
      state: {
        ...state,
        purchased_slots: purchasedSlots,
        max_slots: maxSlots,
        last_cashout: lastCashoutRequest?.requested_at
      },
      machines,
      profile: profile ? { ...profile, referral_count: referralCount || 0 } : null,
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
