CREATE OR REPLACE FUNCTION public.upgrade_machine_atomic(
  p_user_id UUID,
  p_machine_id UUID,
  p_cost NUMERIC,
  p_max_level INT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_oil_balance NUMERIC;
  v_current_level INT;
BEGIN
  -- Lock & Check Balance
  SELECT oil_balance INTO v_oil_balance FROM public.player_state WHERE user_id = p_user_id FOR UPDATE;
  
  IF v_oil_balance < p_cost THEN
    RAISE EXCEPTION 'Insufficient OIL balance';
  END IF;

  -- Lock & Check Machine
  SELECT level INTO v_current_level FROM public.player_machines WHERE id = p_machine_id AND user_id = p_user_id FOR UPDATE;
  
  IF v_current_level IS NULL THEN
    RAISE EXCEPTION 'Machine not found';
  END IF;

  IF v_current_level >= p_max_level THEN
    RAISE EXCEPTION 'Machine already at max level';
  END IF;

  -- Update Balance
  UPDATE public.player_state 
  SET oil_balance = oil_balance - p_cost
  WHERE user_id = p_user_id;

  -- Upgrade Machine
  UPDATE public.player_machines 
  SET level = level + 1 
  WHERE id = p_machine_id;

  RETURN jsonb_build_object(
    'ok', true, 
    'new_balance', v_oil_balance - p_cost,
    'new_level', v_current_level + 1
  );
END;
$$;
