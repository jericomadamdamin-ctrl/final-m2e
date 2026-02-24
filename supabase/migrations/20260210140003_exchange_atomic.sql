CREATE OR REPLACE FUNCTION public.exchange_minerals_atomic(
  p_user_id UUID,
  p_mineral_type TEXT,
  p_amount NUMERIC,
  p_oil_value NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_mineral NUMERIC;
  v_oil_gain NUMERIC;
  v_current_minerals JSONB;
  v_new_minerals JSONB;
BEGIN
  -- Lock Player State
  SELECT minerals INTO v_current_minerals FROM public.player_state WHERE user_id = p_user_id FOR UPDATE;
  
  v_current_mineral := COALESCE((v_current_minerals->>p_mineral_type)::numeric, 0);
  
  IF v_current_mineral < p_amount THEN
    RAISE EXCEPTION 'Insufficient minerals';
  END IF;

  v_oil_gain := p_amount * p_oil_value;
  v_new_minerals := jsonb_set(
    v_current_minerals, 
    ARRAY[p_mineral_type], 
    to_jsonb(v_current_mineral - p_amount)
  );

  -- Execute Exchange
  UPDATE public.player_state 
  SET 
    oil_balance = oil_balance + v_oil_gain,
    minerals = v_new_minerals
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true, 
    'oil_added', v_oil_gain,
    'new_mineral_amount', v_current_mineral - p_amount
  );
END;
$$;
