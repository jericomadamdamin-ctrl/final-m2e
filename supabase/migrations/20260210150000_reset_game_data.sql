-- Reset Game Data (Keep Config & Profiles)

-- Truncate user-specific game data tables
TRUNCATE TABLE 
  public.player_state,
  public.player_machines,
  public.oil_purchases,
  public.machine_purchases,
  public.slot_purchases,
  public.cashout_requests,
  public.cashout_payouts,
  public.referral_bonuses,
  public.app_sessions
RESTART IDENTITY CASCADE;

-- Optionally clear World ID verifications if we want users to re-verify actions?
-- TRUNCATE TABLE public.world_id_verifications RESTART IDENTITY CASCADE;
-- Keeping verifications might be safer to prevent "duplicate verification" errors if doing strictly unique checks.
-- But if we wipe checking history, maybe we should wipe generic verifications?
-- Let's keep world_id_verifications for now to avoid re-verification friction/issues or abuse (re-claiming initial rewards?).

-- Note: We are keeping 'profiles' to preserve:
-- 1. Admin status
-- 2. Wallet linkages
-- 3. World ID linkages (is_human_verified)

-- We are keeping configuration tables:
-- 1. game_config
-- 2. global_game_settings
-- 3. machine_tiers
-- 4. mineral_configs
-- 5. cashout_rounds (Access history preserved? Or generic rounds? Let's keep rounds for now as they are "system" events mostly).
