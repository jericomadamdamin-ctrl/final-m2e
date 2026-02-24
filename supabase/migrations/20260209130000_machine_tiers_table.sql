-- Create the machine_tiers table to pull config out of JSON
-- This supports extensible design for adding new machine types dynamically
CREATE TABLE IF NOT EXISTS public.machine_tiers (
  id TEXT PRIMARY KEY,                       -- 'mini', 'light', 'heavy', 'mega', 'ultra_miner_9000'
  name TEXT NOT NULL,                        -- Display name: 'Mini Machine'
  image_url TEXT,                            -- URL or internal path for the image
  cost_oil NUMERIC NOT NULL,
  speed_actions_per_hour NUMERIC NOT NULL,
  oil_burn_per_hour NUMERIC NOT NULL,
  tank_capacity NUMERIC NOT NULL,
  max_level INTEGER NOT NULL DEFAULT 10,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.machine_tiers ENABLE ROW LEVEL SECURITY;

-- Public read access (config is public info)
CREATE POLICY "Machine tiers public read"
ON public.machine_tiers FOR SELECT
USING (true);

-- Admin write access
CREATE POLICY "Machine tiers admin write"
ON public.machine_tiers FOR ALL
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true));

-- Insert the REBALANCED stats
-- Mini: 3 speed (was 2), 6 burn (was 5), 100 cost
INSERT INTO public.machine_tiers (id, name, image_url, cost_oil, speed_actions_per_hour, oil_burn_per_hour, tank_capacity, max_level)
VALUES
  ('mini', 'Mini Machine', '/assets/machines/mini-machine.png', 100, 3, 6, 5, 10),
  ('light', 'Light Machine', '/assets/machines/light-machine.png', 500, 15, 30, 10, 10),
  ('heavy', 'Heavy Machine', '/assets/machines/heavy-machine.png', 2000, 60, 120, 20, 10),
  ('mega', 'Mega Machine', '/assets/machines/mining-machine.png', 10000, 300, 600, 50, 10)
ON CONFLICT (id) DO UPDATE SET
  speed_actions_per_hour = EXCLUDED.speed_actions_per_hour,
  oil_burn_per_hour = EXCLUDED.oil_burn_per_hour,
  cost_oil = EXCLUDED.cost_oil;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS touch_machine_tiers ON public.machine_tiers;
CREATE TRIGGER touch_machine_tiers
BEFORE UPDATE ON public.machine_tiers
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();
