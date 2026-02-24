-- Increase the daily diamond cap to support the new Mega machine output (~144/day)
-- We set it to 1000 to be safe and allow stacking multiple machines.

UPDATE public.game_config
SET value = jsonb_set(
  value,
  '{diamond_controls, daily_cap_per_user}',
  '1000'::jsonb
)
WHERE key = 'current';
