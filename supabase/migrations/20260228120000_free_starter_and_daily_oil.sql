-- Increase welcome bonus and daily oil reward to make the game playable without WLD.
UPDATE public.global_game_settings SET value = 1000 WHERE key = 'welcome_bonus_oil';
UPDATE public.global_game_settings SET value = 200  WHERE key = 'daily_oil_reward';
