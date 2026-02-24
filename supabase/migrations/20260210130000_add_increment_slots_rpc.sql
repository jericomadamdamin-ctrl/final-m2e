-- Add increment_slots RPC function for atomic updates
CREATE OR REPLACE FUNCTION increment_slots(user_id_param UUID, slots_add INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_total INTEGER;
BEGIN
  UPDATE public.player_state
  SET purchased_slots = purchased_slots + slots_add
  WHERE user_id = user_id_param
  RETURNING purchased_slots INTO new_total;
  
  RETURN new_total;
END;
$$;
