-- Extend oil_purchases for payment confirmations
ALTER TABLE public.oil_purchases
ADD COLUMN IF NOT EXISTS transaction_id TEXT,
ADD COLUMN IF NOT EXISTS to_address TEXT,
ADD COLUMN IF NOT EXISTS metadata JSONB;
