-- Season Machine Pool: admin-configurable machine supply per season.

-- 1) Add machine pool columns to seasons table
ALTER TABLE public.seasons
ADD COLUMN IF NOT EXISTS machine_pool_total INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS machine_pool_remaining INTEGER NOT NULL DEFAULT 0;

-- 2) Atomic RPC to decrement the machine pool on purchase.
--    Returns true if purchase is allowed, false if pool is exhausted.
CREATE OR REPLACE FUNCTION public.decrement_season_machine_pool()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season_id UUID;
  v_pool_total INTEGER;
  v_updated INTEGER;
BEGIN
  -- Find the active season
  SELECT id, machine_pool_total INTO v_season_id, v_pool_total
  FROM public.seasons
  WHERE status = 'active' AND end_time > now()
  ORDER BY created_at DESC
  LIMIT 1;

  -- No active season: allow purchase (no restriction)
  IF v_season_id IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Pool total = 0 means unlimited
  IF v_pool_total = 0 THEN
    RETURN TRUE;
  END IF;

  -- Atomically decrement remaining if > 0
  UPDATE public.seasons
  SET machine_pool_remaining = machine_pool_remaining - 1
  WHERE id = v_season_id
    AND machine_pool_remaining > 0;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN v_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decrement_season_machine_pool() TO anon;
