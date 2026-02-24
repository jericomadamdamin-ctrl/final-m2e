-- Upgrade Machine Tank Capacities to ~24 Hours
-- This allows machines to run for a full day without refueling.

-- 1. Update the machine_tiers table (The Source of Truth)
-- Values: Base Burn * 24 + Buffer
-- Mini: 6 * 24 = 144 -> 150
-- Light: 30 * 24 = 720 -> 750
-- Heavy: 120 * 24 = 2880 -> 3000
-- Mega: 600 * 24 = 14400 -> 15000

UPDATE public.machine_tiers SET tank_capacity = 150 WHERE id = 'mini';
UPDATE public.machine_tiers SET tank_capacity = 750 WHERE id = 'light';
UPDATE public.machine_tiers SET tank_capacity = 3000 WHERE id = 'heavy';
UPDATE public.machine_tiers SET tank_capacity = 15000 WHERE id = 'mega';

-- 2. Update the JSON config (Fallback/Reference)
-- We need to update the huge JSON object in game_config.
-- We use jsonb_set to update specific paths.

UPDATE public.game_config
SET value = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        value,
        '{machines,mini,tank_capacity}', '150'
      ),
      '{machines,light,tank_capacity}', '750'
    ),
    '{machines,heavy,tank_capacity}', '3000'
  ),
  '{machines,mega,tank_capacity}', '15000'
)
WHERE key = 'current';
