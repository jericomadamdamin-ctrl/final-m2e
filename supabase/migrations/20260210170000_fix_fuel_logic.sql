-- Fix Fuel Logic & Apply Balanced Stats
-- 1. Sync level_capacity_multiplier to 0.10 (to match burn rate growth)
-- 2. Apply "Balanced" stats (lower burn, higher safety margin)
-- 3. Ensure BASE capacity is exactly 24 hours of burn

-- Update Global Capacity Multiplier (in global_game_settings if possible, or directly in JSON)
-- Since `level_capacity_multiplier` is part of the JSON blob `game_config`, we update it directly.

UPDATE public.game_config
SET value = jsonb_set(
  value,
  '{progression, level_capacity_multiplier}',
  '0.10'::jsonb
)
WHERE key = 'current';

-- Update Machine Stats (Balanced Profile)

-- Mini Machine (24h)
-- Speed: 3 actions/hr
-- Burn: 6 OIL/hr
-- Capacity: 6 * 24 = 144
UPDATE public.machine_tiers SET
  speed_actions_per_hour = 3,
  oil_burn_per_hour = 6,
  tank_capacity = 144
WHERE id = 'mini';

-- Light Machine (24h)
-- Speed: 15 actions/hr
-- Burn: 30 OIL/hr
-- Capacity: 30 * 24 = 720
UPDATE public.machine_tiers SET
  speed_actions_per_hour = 15,
  oil_burn_per_hour = 30,
  tank_capacity = 720
WHERE id = 'light';

-- Heavy Machine (24h)
-- Speed: 60 actions/hr
-- Burn: 120 OIL/hr
-- Capacity: 120 * 24 = 2880
UPDATE public.machine_tiers SET
  speed_actions_per_hour = 60,
  oil_burn_per_hour = 120,
  tank_capacity = 2880
WHERE id = 'heavy';

-- Mega Machine (Balanced Profile - 24h)
-- Speed: 300 actions/hr (Net +800/day)
-- Burn: 580 OIL/hr
-- Capacity: 580 * 24 = 13920
UPDATE public.machine_tiers SET
  speed_actions_per_hour = 300,
  oil_burn_per_hour = 580,
  tank_capacity = 13920
WHERE id = 'mega';
