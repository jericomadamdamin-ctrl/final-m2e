-- Mega Machine Season Filter
-- Only mega machine purchases count toward the season machine pool.
-- Only users who bought a mega machine during the season appear on the leaderboard.
-- Diamond tracking starts from the moment of mega machine purchase, not retroactively.

-- 1) Add has_mega_machine flag to seasonal_leaderboard
ALTER TABLE public.seasonal_leaderboard
ADD COLUMN IF NOT EXISTS has_mega_machine BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) Replace upsert_seasonal_diamonds: UPDATE-only for mega machine holders.
--    Non-mega users are silently ignored (no INSERT, no error).
CREATE OR REPLACE FUNCTION public.upsert_seasonal_diamonds(
  p_user_id UUID,
  p_diamonds_added NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season_id UUID;
BEGIN
  IF p_diamonds_added <= 0 THEN
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

  UPDATE public.seasonal_leaderboard
  SET diamonds_collected = seasonal_leaderboard.diamonds_collected + p_diamonds_added,
      last_updated = now()
  WHERE user_id = p_user_id
    AND season_id = v_season_id
    AND has_mega_machine = TRUE;
END;
$$;

-- 3) New RPC: register a user as a mega machine buyer for the active season.
--    Creates a leaderboard row with diamonds_collected = 0 so future mining ticks
--    will start accumulating from this point.
CREATE OR REPLACE FUNCTION public.register_season_mega_buyer(
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season_id UUID;
BEGIN
  SELECT id INTO v_season_id
  FROM public.seasons
  WHERE status = 'active' AND end_time > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_season_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.seasonal_leaderboard (user_id, season_id, diamonds_collected, last_updated, has_mega_machine)
  VALUES (p_user_id, v_season_id, 0, now(), TRUE)
  ON CONFLICT (user_id, season_id)
  DO UPDATE SET has_mega_machine = TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_season_mega_buyer(UUID) TO anon;

-- 4) Index for efficient filtering on leaderboard queries
CREATE INDEX IF NOT EXISTS idx_seasonal_lb_mega
ON public.seasonal_leaderboard (season_id, has_mega_machine)
WHERE has_mega_machine = TRUE;
