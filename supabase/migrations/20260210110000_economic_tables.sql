-- Economic Rebalance & Separate Control Tables
-- Migration to move config parameters to individual tables for easier Admin control

-- 1. Modify machine_tiers to support WLD pricing
ALTER TABLE public.machine_tiers ADD COLUMN IF NOT EXISTS cost_wld NUMERIC NOT NULL DEFAULT 0;

-- Update machine tier values with balanced stats and WLD prices
-- Mini: 0.1 WLD, Light: 0.5 WLD, Heavy: 2 WLD, Mega: 10 WLD
UPDATE public.machine_tiers SET cost_wld = 0.1 WHERE id = 'mini';
UPDATE public.machine_tiers SET cost_wld = 0.5 WHERE id = 'light';
UPDATE public.machine_tiers SET cost_wld = 2.0 WHERE id = 'heavy';
UPDATE public.machine_tiers SET cost_wld = 10.0 WHERE id = 'mega';

-- 2. Create mineral_configs table
CREATE TABLE IF NOT EXISTS public.mineral_configs (
  id TEXT PRIMARY KEY,                       -- 'bronze', 'silver', 'gold', 'iron'
  name TEXT NOT NULL,
  oil_value NUMERIC NOT NULL,
  drop_rate NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.mineral_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Mineral configs public read"
ON public.mineral_configs FOR SELECT
USING (true);

CREATE POLICY "Mineral configs admin write"
ON public.mineral_configs FOR ALL
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true));

-- Seed mineral_configs with BALANCED MATH (30-day ROI)
INSERT INTO public.mineral_configs (id, name, oil_value, drop_rate)
VALUES
  ('bronze', 'Bronze', 0.8, 0.40),
  ('silver', 'Silver', 1.5, 0.25),
  ('gold', 'Gold', 5.0, 0.18),
  ('iron', 'Iron', 3.0, 0.15)
ON CONFLICT (id) DO UPDATE SET
  oil_value = EXCLUDED.oil_value,
  drop_rate = EXCLUDED.drop_rate;

-- 3. Create global_game_settings table
CREATE TABLE IF NOT EXISTS public.global_game_settings (
  key TEXT PRIMARY KEY,
  value NUMERIC NOT NULL,
  description TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.global_game_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Global settings public read"
ON public.global_game_settings FOR SELECT
USING (true);

CREATE POLICY "Global settings admin write"
ON public.global_game_settings FOR ALL
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true));

-- Seed global_game_settings
INSERT INTO public.global_game_settings (key, value, description)
VALUES
  ('diamond_drop_rate', 0.002, 'Probability of diamond drop per action'),
  ('upgrade_cost_multiplier', 2.0, 'Multiplier for machine upgrade costs'),
  ('daily_diamond_cap', 1000, 'Maximum diamonds per user per day'),
  ('oil_per_wld', 1000, 'Amount of OIL received per 1 WLD purchase'),
  ('payout_percentage', 0.5, 'Percentage of revenue allocated to payout pool')
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value;

-- 4. Create machine_purchases table for WLD machine tracking
CREATE TABLE IF NOT EXISTS public.machine_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  machine_type TEXT NOT NULL,
  amount_wld NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','failed')),
  reference TEXT UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.machine_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Machine purchases read"
ON public.machine_purchases FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Machine purchases insert"
ON public.machine_purchases FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- 5. Trigger for updated_at
DROP TRIGGER IF EXISTS touch_mineral_configs ON public.mineral_configs;
CREATE TRIGGER touch_mineral_configs
BEFORE UPDATE ON public.mineral_configs
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_global_game_settings ON public.global_game_settings;
CREATE TRIGGER touch_global_game_settings
BEFORE UPDATE ON public.global_game_settings
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();
