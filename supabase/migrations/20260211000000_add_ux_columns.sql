
-- 1. Add new columns to player_state
ALTER TABLE public.player_state 
ADD COLUMN IF NOT EXISTS total_converted_oil NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_daily_claim TIMESTAMPTZ;
