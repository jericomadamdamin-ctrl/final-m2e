-- Secure RLS Policies
-- Revoke direct client-side write access to sensitive tables.
-- All writes must happen via Edge Functions (Service Role).

-- 1. player_state: Read-only for owners. No Insert/Update.
DROP POLICY IF EXISTS "Player state insert" ON public.player_state;
DROP POLICY IF EXISTS "Player state update" ON public.player_state;
-- (Read policy remains: "Player state read")

-- 2. player_machines: Read-only for owners. No Insert/Update.
DROP POLICY IF EXISTS "Player machines insert" ON public.player_machines;
DROP POLICY IF EXISTS "Player machines update" ON public.player_machines;
-- (Read policy remains: "Player machines read")

-- 3. referral_bonuses: No public insert.
DROP POLICY IF EXISTS "Referral bonuses insert" ON public.referral_bonuses;
-- (Read policy remains: "Referral bonuses read")

-- 4. oil_purchases: Read-only for owners. Inserts must happen via Edge Function.
DROP POLICY IF EXISTS "Oil purchases insert" ON public.oil_purchases;
-- (Read policy remains: "Oil purchases read")

-- Note: user_id checks are still enforced on SELECT by existing policies.
