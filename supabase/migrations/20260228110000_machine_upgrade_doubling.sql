-- Update machine upgrade base costs for doubling progression.
-- New formula: cost_oil * 2^(level-1) per upgrade level.
UPDATE public.machine_tiers SET cost_oil = 1000   WHERE id = 'mini';
UPDATE public.machine_tiers SET cost_oil = 5000   WHERE id = 'light';
UPDATE public.machine_tiers SET cost_oil = 20000  WHERE id = 'heavy';
UPDATE public.machine_tiers SET cost_oil = 100000 WHERE id = 'mega';
