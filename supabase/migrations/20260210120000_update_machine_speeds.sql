UPDATE public.machine_tiers SET 
  speed_actions_per_hour = 5,
  oil_burn_per_hour = 10,
  tank_capacity = 250
WHERE id = 'mini';

UPDATE public.machine_tiers SET 
  speed_actions_per_hour = 24,
  oil_burn_per_hour = 48,
  tank_capacity = 1200
WHERE id = 'light';

UPDATE public.machine_tiers SET 
  speed_actions_per_hour = 96,
  oil_burn_per_hour = 192,
  tank_capacity = 4800
WHERE id = 'heavy';

UPDATE public.machine_tiers SET 
  speed_actions_per_hour = 480,
  oil_burn_per_hour = 960,
  tank_capacity = 24000
WHERE id = 'mega';
