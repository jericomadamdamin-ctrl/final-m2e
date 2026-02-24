-- Auto Revenue-Based Rewards
-- Track mega machine revenue per season and support oil rewards.

-- 1) Track running WLD revenue on the seasons table
ALTER TABLE public.seasons
ADD COLUMN IF NOT EXISTS revenue_wld NUMERIC NOT NULL DEFAULT 0;

-- 2) Support oil rewards alongside WLD in season_rewards
ALTER TABLE public.season_rewards
ADD COLUMN IF NOT EXISTS reward_oil NUMERIC NOT NULL DEFAULT 0;

-- 3) Atomic RPC: increment revenue for the active season
CREATE OR REPLACE FUNCTION public.increment_season_revenue(
  p_amount NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season_id UUID;
BEGIN
  IF p_amount <= 0 THEN
    RETURN;
  END IF;

  SELECT id INTO v_season_id
  FROM public.seasons
  WHERE status = 'active' AND end_time > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_season_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.seasons
  SET revenue_wld = revenue_wld + p_amount
  WHERE id = v_season_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_season_revenue(NUMERIC) TO anon;
