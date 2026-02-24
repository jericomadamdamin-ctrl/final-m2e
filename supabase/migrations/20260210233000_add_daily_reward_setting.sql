
-- Ensure global_game_settings table exists
CREATE TABLE IF NOT EXISTS public.global_game_settings (
    key TEXT PRIMARY KEY,
    value NUMERIC NOT NULL,
    description TEXT
);

-- Enable RLS just in case, though it's public read usually? 
-- Actually admin-db uses service role, so RLS doesn't block it.
-- But let's leave it open for now or standard.

-- Insert daily_oil_reward setting
INSERT INTO public.global_game_settings (key, value, description)
VALUES ('daily_oil_reward', 5, 'Amount of Oil users claim daily')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
