CREATE OR REPLACE FUNCTION public.fuel_machine_atomic(
  p_user_id UUID,
  p_machine_id UUID,
  p_amount NUMERIC,
  p_max_capacity NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_oil_balance NUMERIC;
  v_current_fuel NUMERIC;
  v_actual_add NUMERIC;
BEGIN
  -- Lock & Check Balance
  SELECT oil_balance INTO v_oil_balance FROM public.player_state WHERE user_id = p_user_id FOR UPDATE;
  
  IF v_oil_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient OIL balance';
  END IF;

  -- Lock & Check Machine
  SELECT fuel_oil INTO v_current_fuel FROM public.player_machines WHERE id = p_machine_id AND user_id = p_user_id FOR UPDATE;
  
  IF v_current_fuel IS NULL THEN
    RAISE EXCEPTION 'Machine not found';
  END IF;

  -- Cap the amount
  v_actual_add := LEAST(p_amount, p_max_capacity - v_current_fuel);
  
  IF v_actual_add <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'filled', 0, 'new_balance', v_oil_balance);
  END IF;

  -- Update Balance
  UPDATE public.player_state 
  SET oil_balance = oil_balance - v_actual_add 
  WHERE user_id = p_user_id;

  -- Update Machine
  UPDATE public.player_machines 
  SET fuel_oil = fuel_oil + v_actual_add 
  WHERE id = p_machine_id;

  RETURN jsonb_build_object(
    'ok', true, 
    'filled', v_actual_add, 
    'new_balance', v_oil_balance - v_actual_add,
    'new_fuel', v_current_fuel + v_actual_add
  );
END;
$$;
