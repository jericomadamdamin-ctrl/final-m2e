-- Ensure one payout row per (round, user) so processing can be retried idempotently.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cashout_payouts_round_user
ON public.cashout_payouts (round_id, user_id);
