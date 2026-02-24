-- Referral system migration
-- Adds referral tracking to profiles and bonus log table

-- Add referral columns to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS referral_bonus_paid BOOLEAN NOT NULL DEFAULT false;

-- Create index for referral code lookups
CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON public.profiles(referral_code);

-- Auto-generate referral code from wallet address
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.wallet_address IS NOT NULL AND NEW.referral_code IS NULL THEN
    NEW.referral_code := UPPER(SUBSTRING(NEW.wallet_address FROM 3 FOR 8));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS set_referral_code ON public.profiles;
CREATE TRIGGER set_referral_code
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION generate_referral_code();

-- Backfill existing profiles with referral codes
UPDATE public.profiles
SET referral_code = UPPER(SUBSTRING(wallet_address FROM 3 FOR 8))
WHERE wallet_address IS NOT NULL AND referral_code IS NULL;

-- Referral bonus log table
CREATE TABLE IF NOT EXISTS public.referral_bonuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  diamonds_awarded NUMERIC NOT NULL DEFAULT 1,
  awarded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(referrer_id, referred_id)
);

ALTER TABLE public.referral_bonuses ENABLE ROW LEVEL SECURITY;

-- RLS: referrer can read their own bonuses
CREATE POLICY "Referral bonuses read"
ON public.referral_bonuses FOR SELECT
USING (auth.uid() = referrer_id);

-- Allow service role to insert
CREATE POLICY "Referral bonuses insert"
ON public.referral_bonuses FOR INSERT
WITH CHECK (true);
