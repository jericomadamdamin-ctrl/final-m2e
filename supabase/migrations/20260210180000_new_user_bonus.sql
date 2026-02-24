-- New User Bonus Setting
-- Introduce 'welcome_bonus_oil' to global settings so admins can adjust the starting amount.

INSERT INTO public.global_game_settings (key, value, description)
VALUES (
  'welcome_bonus_oil',
  500,
  'Amount of OIL given to new players upon first login'
)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value;
