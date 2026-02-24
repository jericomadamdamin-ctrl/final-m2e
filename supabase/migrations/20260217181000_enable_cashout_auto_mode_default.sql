-- Ensure autonomous cashout mode is ON by default.
UPDATE public.global_game_settings
SET value = 1
WHERE key = 'cashout_auto_finalize_enabled';
