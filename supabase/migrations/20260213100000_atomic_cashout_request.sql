-- Atomic Cashout Request Function
-- Prevents double-spending of diamonds by locking the player state and performing deduction + insertion in one transaction.

CREATE OR REPLACE FUNCTION public.submit_cashout_request(
  p_user_id UUID,
  p_diamonds NUMERIC,
  p_round_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with privileges of creator (postgres) to allow locking/updates even if RLS would block (though RLS allows owner)
SET search_path = public
AS $$
DECLARE
  v_current_balance NUMERIC;
  v_req_id UUID;
BEGIN
  -- 1. Check & Lock Player Balance
  SELECT diamond_balance INTO v_current_balance
  FROM public.player_state
  WHERE user_id = p_user_id
  FOR UPDATE; -- Explicit row lock

  IF v_current_balance IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Player state not found');
  END IF;

  IF v_current_balance < p_diamonds THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Insufficient diamonds');
  END IF;

  -- 2. Deduct Diamonds
  UPDATE public.player_state
  SET diamond_balance = diamond_balance - p_diamonds,
      updated_at = now()
  WHERE user_id = p_user_id;

  -- 3. Create Request
  INSERT INTO public.cashout_requests (
    user_id,
    diamonds_submitted,
    payout_round_id,
    status,
    requested_at
  )
  VALUES (
    p_user_id,
    p_diamonds,
    p_round_id,
    'pending',
    now()
  )
  RETURNING id INTO v_req_id;

  -- 4. Update Round Total (Increment)
  UPDATE public.cashout_rounds
  SET total_diamonds = COALESCE(total_diamonds, 0) + p_diamonds
  WHERE id = p_round_id;

  -- 5. Return Success
  RETURN jsonb_build_object('ok', true, 'request_id', v_req_id, 'new_balance', v_current_balance - p_diamonds);

EXCEPTION WHEN OTHERS THEN
  -- Capture any other errors
  RETURN jsonb_build_object('ok', false, 'message', SQLERRM);
END;
$$;
