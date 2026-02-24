-- Season System: admin-managed seasons with reward tiers and leaderboard tracking.

-- 1) Extend seasons table with admin fields
ALTER TABLE public.seasons
ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Season',
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
ADD COLUMN IF NOT EXISTS reward_tiers JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'seasons_status_check'
  ) THEN
    ALTER TABLE public.seasons
    ADD CONSTRAINT seasons_status_check
    CHECK (status IN ('draft', 'active', 'ended', 'rewarded'));
  END IF;
END $$;

-- Migrate existing rows: is_active=true -> status='active', others -> 'ended'
UPDATE public.seasons
SET status = CASE
  WHEN is_active = true AND end_time > now() THEN 'active'
  ELSE 'ended'
END
WHERE status = 'draft';

-- 2) Create season_rewards table for tracking reward distribution
CREATE TABLE IF NOT EXISTS public.season_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  diamonds_collected NUMERIC NOT NULL DEFAULT 0,
  reward_wld NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  UNIQUE(season_id, user_id)
);

ALTER TABLE public.season_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Season rewards public read"
ON public.season_rewards FOR SELECT
USING (true);

-- 3) RPC: atomically upsert diamond earnings into the seasonal leaderboard
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

  INSERT INTO public.seasonal_leaderboard (user_id, season_id, diamonds_collected, last_updated)
  VALUES (p_user_id, v_season_id, p_diamonds_added, now())
  ON CONFLICT (user_id, season_id)
  DO UPDATE SET
    diamonds_collected = seasonal_leaderboard.diamonds_collected + p_diamonds_added,
    last_updated = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_seasonal_diamonds(UUID, NUMERIC) TO anon;

-- 4) Update get_or_create_active_season to use the new status column
CREATE OR REPLACE FUNCTION public.get_or_create_active_season()
RETURNS UUID AS $$
DECLARE
  active_season_id UUID;
BEGIN
  SELECT id INTO active_season_id
  FROM public.seasons
  WHERE status = 'active' AND end_time > now()
  LIMIT 1;

  IF active_season_id IS NULL THEN
    UPDATE public.seasons
    SET status = 'ended', is_active = false, ended_at = now()
    WHERE status = 'active';

    INSERT INTO public.seasons (name, start_time, end_time, is_active, status)
    VALUES ('Season', now(), now() + interval '720 hours', true, 'active')
    RETURNING id INTO active_season_id;
  END IF;

  RETURN active_season_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5) Index for fast season lookups
CREATE INDEX IF NOT EXISTS idx_seasons_status ON public.seasons(status);
CREATE INDEX IF NOT EXISTS idx_season_rewards_season ON public.season_rewards(season_id);
