import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, requireUserId } from '../_shared/supabase.ts';
import { getGameConfig, processMining } from '../_shared/mining.ts';

const logTiming = (label: string, startMs: number) => {
  const elapsed = Date.now() - startMs;
  console.log(`[game-state] ${label}: ${elapsed}ms`);
};

const unwrapOptionalData = <T,>(
  label: string,
  result: PromiseSettledResult<{ data: T; error: { message?: string | null } | null }>,
  fallback: T,
): T => {
  if (result.status === 'rejected') {
    console.warn(`[game-state] ${label} query rejected:`, result.reason);
    return fallback;
  }

  if (result.value.error) {
    console.warn(`[game-state] ${label} query failed:`, result.value.error.message ?? 'unknown error');
    return fallback;
  }

  return result.value.data ?? fallback;
};

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const totalStart = Date.now();

  try {
    const authStart = Date.now();
    const userId = await requireUserId(req);
    logTiming('auth', authStart);

    const configStart = Date.now();
    const config = await getGameConfig();
    logTiming('getGameConfig', configStart);

    const miningStart = Date.now();
    const { state, machines } = await processMining(userId, { config });
    logTiming('processMining', miningStart);

    const admin = getAdminClient();
    const profileStart = Date.now();
    const [profileResult, referralResult, cashoutResult] = await Promise.allSettled([
      admin
        .from('profiles')
        .select('player_name, is_admin, is_human_verified, wallet_address, referral_code')
        .eq('id', userId)
        .maybeSingle(),
      admin
        .from('referral_bonuses')
        .select('*', { count: 'exact', head: true })
        .eq('referrer_id', userId),
      admin
        .from('cashout_requests')
        .select('requested_at')
        .eq('user_id', userId)
        .order('requested_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const profile = unwrapOptionalData<{
      player_name: string | null;
      is_admin: boolean | null;
      is_human_verified: boolean | null;
      wallet_address: string | null;
      referral_code: string | null;
    } | null>('profile', profileResult, null);

    let referralCount = 0;
    if (referralResult.status === 'rejected') {
      console.warn('[game-state] referral_bonuses query rejected:', referralResult.reason);
    } else if (referralResult.value.error) {
      console.warn('[game-state] referral_bonuses query failed:', referralResult.value.error.message ?? 'unknown error');
    } else {
      referralCount = Number(referralResult.value.count ?? 0);
    }

    const lastCashoutRequest = unwrapOptionalData<{ requested_at: string } | null>('cashout_requests', cashoutResult, null);
    logTiming('profile+referral+cashout', profileStart);

    const slotConfig = (config as any).slots ?? { base_slots: 10, max_total_slots: 30 };
    const purchasedSlots = Number((state as any).purchased_slots ?? 0);
    const maxSlots = Math.min(slotConfig.base_slots + purchasedSlots, slotConfig.max_total_slots);

    logTiming('total', totalStart);

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
    const msg = (err as Error).message;
    console.error('[game-state] error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
