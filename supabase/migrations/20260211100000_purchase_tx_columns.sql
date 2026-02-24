-- Add transaction_id, to_address, metadata columns to machine_purchases and slot_purchases
-- (oil_purchases already has these from migration 20260206110000_oil_purchase_tx.sql)

ALTER TABLE public.machine_purchases
  ADD COLUMN IF NOT EXISTS transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS to_address TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

ALTER TABLE public.slot_purchases
  ADD COLUMN IF NOT EXISTS transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS to_address TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB;
