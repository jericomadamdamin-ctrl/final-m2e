-- Ensure slot purchase crediting is idempotent across retries/reconciliation.

CREATE TABLE IF NOT EXISTS public.slot_purchase_credits (
  purchase_id UUID PRIMARY KEY REFERENCES public.slot_purchases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  slots_added INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.slot_purchase_credits ENABLE ROW LEVEL SECURITY;

-- No direct client policies; service-role edge functions manage this table.

CREATE OR REPLACE FUNCTION public.increment_slots_for_purchase(
  p_purchase_id UUID,
  p_user_id UUID,
  p_slots_add INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_total INTEGER;
BEGIN
  INSERT INTO public.slot_purchase_credits (purchase_id, user_id, slots_added)
  VALUES (p_purchase_id, p_user_id, p_slots_add)
  ON CONFLICT (purchase_id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT purchased_slots
    INTO v_new_total
    FROM public.player_state
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object(
      'ok', true,
      'credited', false,
      'new_total', COALESCE(v_new_total, 0)
    );
  END IF;

  UPDATE public.player_state
  SET purchased_slots = purchased_slots + p_slots_add
  WHERE user_id = p_user_id
  RETURNING purchased_slots INTO v_new_total;

  RETURN jsonb_build_object(
    'ok', true,
    'credited', true,
    'new_total', COALESCE(v_new_total, 0)
  );
END;
$$;
