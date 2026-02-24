-- Remove cashout request frequency limits from config semantics.
-- Backend no longer enforces:
-- - cashout.cooldown_days
-- - anti_abuse.rate_limits.cashout_requests_per_day

UPDATE public.game_config
SET value = jsonb_set(
  value,
  '{cashout,cooldown_days}',
  '0'::jsonb,
  true
)
WHERE key = 'current';

UPDATE public.game_config
SET value = value #- '{anti_abuse,rate_limits,cashout_requests_per_day}'
WHERE key = 'current';
