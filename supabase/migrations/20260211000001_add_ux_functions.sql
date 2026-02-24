
-- 2. Update exchange_minerals_atomic to track total_converted_oil
-- FUNCTION COMMENTED OUT FOR DEBUGGING
-- DROP FUNCTION IF EXISTS public.exchange_minerals_atomic(UUID, TEXT, NUMERIC, NUMERIC);
-- CREATE OR REPLACE FUNCTION public.exchange_minerals_atomic(...)

-- 3. Create claim_daily_reward RPC
DROP FUNCTION IF EXISTS public.claim_daily_reward(UUID, NUMERIC);
CREATE OR REPLACE FUNCTION public.claim_daily_reward(
  p_user_id UUID,
  p_reward_amount NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_last_claim TIMESTAMPTZ;
  v_now TIMESTAMPTZ := NOW();
  v_new_balance NUMERIC;
BEGIN
  -- Lock Player State
  SELECT last_daily_claim, oil_balance INTO v_last_claim, v_new_balance FROM public.player_state WHERE user_id = p_user_id FOR UPDATE;
  
  -- Check if recently claimed (within last 24 hours)
  IF v_last_claim IS NOT NULL AND v_now < (v_last_claim + INTERVAL '24 hours') THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Daily reward already claimed');
  END IF;

  -- Update State
  UPDATE public.player_state
  SET 
    oil_balance = oil_balance + p_reward_amount,
    last_daily_claim = v_now
  WHERE user_id = p_user_id
  RETURNING oil_balance INTO v_new_balance;

  RETURN jsonb_build_object(
    'ok', true,
    'new_balance', v_new_balance,
    'next_claim', v_now + INTERVAL '24 hours'
  );
END;
$$;
