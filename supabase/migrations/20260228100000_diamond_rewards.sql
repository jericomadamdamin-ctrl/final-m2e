-- Diamond rewards for season ranks 4-10
ALTER TABLE public.season_rewards
ADD COLUMN IF NOT EXISTS reward_diamonds NUMERIC NOT NULL DEFAULT 0;
