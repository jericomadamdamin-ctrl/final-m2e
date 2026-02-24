-- Add tx_hash to cashout_payouts to track blockchain transaction IDs
ALTER TABLE public.cashout_payouts
ADD COLUMN IF NOT EXISTS tx_hash TEXT;
