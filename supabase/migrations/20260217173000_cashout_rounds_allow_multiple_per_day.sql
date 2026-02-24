-- Allow multiple cashout rounds per day.
-- This removes hard single-round/day gating that caused "Cashout round is closed"
-- once a day's round had already been finalized.

ALTER TABLE public.cashout_rounds
DROP CONSTRAINT IF EXISTS cashout_rounds_round_date_key;

CREATE INDEX IF NOT EXISTS idx_cashout_rounds_round_date
ON public.cashout_rounds (round_date);

CREATE INDEX IF NOT EXISTS idx_cashout_rounds_round_date_status
ON public.cashout_rounds (round_date, status);
