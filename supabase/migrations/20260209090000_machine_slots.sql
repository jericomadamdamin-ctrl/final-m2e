-- Machine Slot System Migration
-- Adds slot limits and purchase tracking

-- Add purchased_slots column to player_state
ALTER TABLE public.player_state
ADD COLUMN IF NOT EXISTS purchased_slots INTEGER NOT NULL DEFAULT 0;

-- Update game_config with slot settings
UPDATE public.game_config
SET value = jsonb_set(
  value,
  '{slots}',
  '{
    "base_slots": 10,
    "slot_pack_size": 5,
    "slot_pack_price_wld": 1,
    "max_total_slots": 30
  }'::jsonb
)
WHERE key = 'current';

-- Create slot_purchases table for tracking
CREATE TABLE IF NOT EXISTS public.slot_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  slots_purchased INTEGER NOT NULL,
  amount_wld NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','failed')),
  reference TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.slot_purchases ENABLE ROW LEVEL SECURITY;

-- RLS: user can read own purchases
DO $$ 
BEGIN 
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Slot purchases read' AND tablename = 'slot_purchases'
  ) THEN
    CREATE POLICY "Slot purchases read"
    ON public.slot_purchases FOR SELECT
    USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ 
BEGIN 
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Slot purchases insert' AND tablename = 'slot_purchases'
  ) THEN
    CREATE POLICY "Slot purchases insert"
    ON public.slot_purchases FOR INSERT
    WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
