-- Create profiles table for user game data
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  minerals JSONB NOT NULL DEFAULT '{"bronze": 0, "silver": 0, "gold": 0, "iron": 0, "diamond": 0}',
  oil_tokens NUMERIC NOT NULL DEFAULT 200,
  world_coins NUMERIC NOT NULL DEFAULT 0,
  machines JSONB NOT NULL DEFAULT '[]',
  referral_code TEXT UNIQUE,
  referral_count INTEGER NOT NULL DEFAULT 0,
  entered_referral_code TEXT,
  last_daily_claim TIMESTAMP WITH TIME ZONE,
  daily_claim_streak INTEGER NOT NULL DEFAULT 0,
  achievement_progress JSONB NOT NULL DEFAULT '{}',
  claimed_achievements JSONB NOT NULL DEFAULT '[]',
  stats JSONB NOT NULL DEFAULT '{"totalMachinesBought": 0, "totalUpgrades": 0, "totalMineralsCollected": {"bronze": 0, "silver": 0, "gold": 0, "iron": 0, "diamond": 0}, "totalOilEarned": 0, "totalExchanges": 0, "dailyClaimCount": 0, "maxLevelMachines": 0}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create seasons table to track leaderboard seasons
CREATE TABLE public.seasons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  end_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '720 hours'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create seasonal leaderboard table
CREATE TABLE public.seasonal_leaderboard (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  diamonds_collected NUMERIC NOT NULL DEFAULT 0,
  last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, season_id)
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasonal_leaderboard ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view all profiles"
ON public.profiles FOR SELECT
USING (true);

CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
USING (auth.uid() = id);

-- Seasons policies (public read)
CREATE POLICY "Anyone can view seasons"
ON public.seasons FOR SELECT
USING (true);

-- Leaderboard policies (public read)
CREATE POLICY "Anyone can view leaderboard"
ON public.seasonal_leaderboard FOR SELECT
USING (true);

CREATE POLICY "Users can insert their own leaderboard entry"
ON public.seasonal_leaderboard FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own leaderboard entry"
ON public.seasonal_leaderboard FOR UPDATE
USING (auth.uid() = user_id);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to generate referral code
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TRIGGER AS $$
BEGIN
  NEW.referral_code = upper(substring(md5(random()::text) from 1 for 8));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger to auto-generate referral code on profile creation
CREATE TRIGGER generate_profile_referral_code
BEFORE INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.generate_referral_code();

-- Create function to get or create active season
CREATE OR REPLACE FUNCTION public.get_or_create_active_season()
RETURNS UUID AS $$
DECLARE
  active_season_id UUID;
BEGIN
  -- Check for existing active season that hasn't expired
  SELECT id INTO active_season_id
  FROM public.seasons
  WHERE is_active = true AND end_time > now()
  LIMIT 1;
  
  -- If no active season, create one
  IF active_season_id IS NULL THEN
    -- Deactivate old seasons
    UPDATE public.seasons SET is_active = false WHERE is_active = true;
    
    -- Create new season
    INSERT INTO public.seasons (start_time, end_time, is_active)
    VALUES (now(), now() + interval '720 hours', true)
    RETURNING id INTO active_season_id;
  END IF;
  
  RETURN active_season_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create initial season
INSERT INTO public.seasons (start_time, end_time, is_active)
VALUES (now(), now() + interval '720 hours', true);