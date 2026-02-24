-- Verification: Check payouts and wallet addresses for round 612beddd
-- This is a SECURITY DEFINER function so it can bypass RLS

CREATE OR REPLACE FUNCTION public.verify_payouts(p_round_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'payout_id', cp.id,
    'user_id', cp.user_id,
    'diamonds_burned', cp.diamonds_burned,
    'payout_wld', cp.payout_wld,
    'payout_status', cp.status,
    'wallet_address', p.wallet_address,
    'player_name', p.player_name
  )), '[]'::jsonb)
  INTO v_result
  FROM cashout_payouts cp
  JOIN profiles p ON p.id = cp.user_id
  WHERE cp.round_id = p_round_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_payouts(UUID) TO anon;
