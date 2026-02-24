-- Direct payout auto mode + refund-on-failure support

-- 1) Auto-mode settings
INSERT INTO public.global_game_settings (key, value, description)
VALUES
  ('cashout_auto_finalize_enabled', 0, 'Enable autonomous cashout finalization/execution pipeline (0/1)'),
  ('cashout_finalize_interval_seconds', 120, 'Minimum age in seconds before auto-finalize can process an open round'),
  ('cashout_auto_execute_batch_size', 25, 'Batch size used by autonomous cashout execution worker')
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description;

-- 2) Round signal queue to wire request -> auto worker
CREATE TABLE IF NOT EXISTS public.cashout_round_signals (
  round_id UUID PRIMARY KEY REFERENCES public.cashout_rounds(id) ON DELETE CASCADE,
  signal_count INTEGER NOT NULL DEFAULT 0,
  last_signaled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cashout_round_signals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cashout_round_signals'
      AND policyname = 'Cashout round signals admin read'
  ) THEN
    CREATE POLICY "Cashout round signals admin read"
    ON public.cashout_round_signals FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_admin = true
      )
    );
  END IF;
END $$;

-- 3) Refund metadata
ALTER TABLE public.cashout_requests
ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS refund_reason TEXT;

-- 4) Expand request status for refunded terminal state
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cashout_requests_status_check'
  ) THEN
    ALTER TABLE public.cashout_requests DROP CONSTRAINT cashout_requests_status_check;
  END IF;
END $$;

ALTER TABLE public.cashout_requests
ADD CONSTRAINT cashout_requests_status_check
CHECK (status IN ('pending', 'approved', 'paid', 'rejected', 'refunded'));

-- 5) Expand payout status for refunded terminal state
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cashout_payouts_status_check'
  ) THEN
    ALTER TABLE public.cashout_payouts DROP CONSTRAINT cashout_payouts_status_check;
  END IF;
END $$;

ALTER TABLE public.cashout_payouts
ADD CONSTRAINT cashout_payouts_status_check
CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'refunded'));

-- 6) Queue signal RPC (idempotent upsert/increment)
CREATE OR REPLACE FUNCTION public.signal_cashout_round(
  p_round_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.cashout_round_signals (round_id, signal_count, last_signaled_at, updated_at)
  VALUES (p_round_id, 1, now(), now())
  ON CONFLICT (round_id)
  DO UPDATE SET
    signal_count = cashout_round_signals.signal_count + 1,
    last_signaled_at = now(),
    updated_at = now();

  RETURN jsonb_build_object('ok', true, 'round_id', p_round_id);
END;
$$;

-- 7) Refund RPC (atomic + idempotent)
CREATE OR REPLACE FUNCTION public.refund_cashout_payout(
  p_payout_id UUID,
  p_reason TEXT DEFAULT 'payout_execution_failed'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout public.cashout_payouts%ROWTYPE;
  v_current_balance NUMERIC;
  v_refunded BOOLEAN := false;
BEGIN
  SELECT *
  INTO v_payout
  FROM public.cashout_payouts
  WHERE id = p_payout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout not found: %', p_payout_id;
  END IF;

  IF v_payout.status = 'refunded' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'refunded', false,
      'already_refunded', true,
      'payout_id', p_payout_id,
      'reason', p_reason
    );
  END IF;

  IF v_payout.status = 'paid' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'refunded', false,
      'already_paid', true,
      'payout_id', p_payout_id,
      'reason', p_reason
    );
  END IF;

  SELECT diamond_balance
  INTO v_current_balance
  FROM public.player_state
  WHERE user_id = v_payout.user_id
  FOR UPDATE;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION 'Player state missing for user %', v_payout.user_id;
  END IF;

  UPDATE public.player_state
  SET diamond_balance = diamond_balance + COALESCE(v_payout.diamonds_burned, 0),
      updated_at = now()
  WHERE user_id = v_payout.user_id;

  UPDATE public.cashout_payouts
  SET status = 'refunded',
      last_error = p_reason,
      processing_started_at = NULL,
      updated_at = now()
  WHERE id = p_payout_id;

  UPDATE public.cashout_requests
  SET status = 'refunded',
      refunded_at = now(),
      refund_reason = p_reason,
      processed_at = COALESCE(processed_at, now())
  WHERE payout_round_id = v_payout.round_id
    AND user_id = v_payout.user_id
    AND status IN ('pending', 'approved');

  v_refunded := true;

  RETURN jsonb_build_object(
    'ok', true,
    'refunded', v_refunded,
    'payout_id', p_payout_id,
    'user_id', v_payout.user_id,
    'diamonds_refunded', COALESCE(v_payout.diamonds_burned, 0),
    'reason', p_reason
  );
END;
$$;

-- 8) Treat refunded as terminal completion state
CREATE OR REPLACE FUNCTION public.complete_cashout_round_if_done(
  p_round_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending_like INTEGER := 0;
  v_failed INTEGER := 0;
  v_round_status TEXT;
BEGIN
  SELECT status
  INTO v_round_status
  FROM public.cashout_rounds
  WHERE id = p_round_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found: %', p_round_id;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE status IN ('pending', 'processing')),
    COUNT(*) FILTER (WHERE status = 'failed')
  INTO v_pending_like, v_failed
  FROM public.cashout_payouts
  WHERE round_id = p_round_id;

  IF v_pending_like = 0 AND v_failed = 0 THEN
    UPDATE public.cashout_rounds
    SET status = 'paid',
        paid_at = COALESCE(paid_at, now()),
        updated_at = now()
    WHERE id = p_round_id;

    RETURN jsonb_build_object(
      'ok', true,
      'round_id', p_round_id,
      'status', 'paid',
      'message', 'Round promoted to paid'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'round_id', p_round_id,
    'status', v_round_status,
    'pending_or_processing', v_pending_like,
    'failed', v_failed,
    'message', 'Round still has outstanding payouts'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.signal_cashout_round(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.refund_cashout_payout(UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.complete_cashout_round_if_done(UUID) TO anon;
