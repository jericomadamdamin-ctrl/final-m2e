-- Add diamond_wld_exchange_rate to global_game_settings
-- This setting defines the fixed WLD value per diamond for cashout rounds

INSERT INTO public.global_game_settings (key, value, description)
VALUES ('diamond_wld_exchange_rate', 0.1, 'Fixed WLD value per diamond for cashout rounds')
ON CONFLICT (key) DO UPDATE SET 
  value = EXCLUDED.value,
  description = EXCLUDED.description;
