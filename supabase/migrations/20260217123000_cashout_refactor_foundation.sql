-- Cashout refactor foundation:
-- - state model hardening
-- - transactional finalize/recalculate RPCs
-- - payout claim + round completion helpers

-- 1) Schema hardening
ALTER TABLE public.cashout_rounds
ADD COLUMN IF NOT EXISTS pool_rule TEXT,
ADD COLUMN IF NOT EXISTS pool_rule_input JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cashout_rounds_pool_rule_check'
  ) THEN
    ALTER TABLE public.cashout_rounds
    ADD CONSTRAINT cashout_rounds_pool_rule_check
    CHECK (pool_rule IS NULL OR pool_rule IN ('diamond_rate', 'manual_override'));
  END IF;
END $$;

ALTER TABLE public.cashout_payouts
ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_error TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cashout_payouts_status_check'
  ) THEN
    ALTER TABLE public.cashout_payouts DROP CONSTRAINT cashout_payouts_status_check;
  END IF;
END $$;

ALTER TABLE public.cashout_payouts
ADD CONSTRAINT cashout_payouts_status_check
CHECK (status IN ('pending', 'processing', 'paid', 'failed'));

CREATE INDEX IF NOT EXISTS idx_cashout_payouts_round_status
ON public.cashout_payouts (round_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS ux_cashout_payouts_tx_hash
ON public.cashout_payouts (tx_hash)
WHERE tx_hash IS NOT NULL;

-- 2) Data backfill safety
UPDATE public.cashout_rounds
SET updated_at = COALESCE(updated_at, created_at, now());

UPDATE public.cashout_payouts
SET updated_at = COALESCE(updated_at, created_at, now());

-- Legacy normalization: if all payouts are paid for a closed round, promote to paid.
UPDATE public.cashout_rounds r
SET status = 'paid',
    paid_at = COALESCE(r.paid_at, now()),
    updated_at = now()
WHERE r.status = 'closed'
  AND EXISTS (
    SELECT 1 FROM public.cashout_payouts p WHERE p.round_id = r.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.cashout_payouts p
    WHERE p.round_id = r.id
      AND p.status IN ('pending', 'processing', 'failed')
  );

-- 3) Finalize round (atomic)
CREATE OR REPLACE FUNCTION public.finalize_cashout_round(
  p_round_id UUID,
  p_manual_pool_wld NUMERIC DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_round public.cashout_rounds%ROWTYPE;
  v_rate NUMERIC := 0.1;
  v_total_diamonds NUMERIC := 0;
  v_target_pool NUMERIC := 0;
  v_pool_rule TEXT := 'diamond_rate';
  v_pool_input JSONB := '{}'::jsonb;
  v_total_count INTEGER := 0;
  v_idx INTEGER := 0;
  v_remaining_pool NUMERIC := 0;
  v_share NUMERIC := 0;
  v_payout NUMERIC := 0;
  v_req RECORD;
BEGIN
  SELECT *
  INTO v_round
  FROM public.cashout_rounds
  WHERE id = p_round_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found: %', p_round_id;
  END IF;

  IF v_round.status = 'paid' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'message', 'Round already paid',
      'round_id', p_round_id,
      'status', v_round.status,
      'total_diamonds', v_round.total_diamonds,
      'payout_pool', v_round.payout_pool_wld
    );
  END IF;

  IF v_round.status = 'closed' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'message', 'Round already closed',
      'round_id', p_round_id,
      'status', v_round.status,
      'total_diamonds', v_round.total_diamonds,
      'payout_pool', v_round.payout_pool_wld
    );
  END IF;

  IF v_round.status <> 'open' THEN
    RAISE EXCEPTION 'Round % is in unexpected status %', p_round_id, v_round.status;
  END IF;

  IF p_manual_pool_wld IS NOT NULL AND p_manual_pool_wld < 0 THEN
    RAISE EXCEPTION 'manual_pool_wld must be >= 0';
  END IF;

  SELECT COALESCE(SUM(diamonds_submitted), 0), COUNT(*)
  INTO v_total_diamonds, v_total_count
  FROM public.cashout_requests
  WHERE payout_round_id = p_round_id
    AND status IN ('pending', 'approved');

  IF p_manual_pool_wld IS NOT NULL THEN
    v_target_pool := p_manual_pool_wld;
    v_pool_rule := 'manual_override';
    v_pool_input := jsonb_build_object(
      'manual_pool_wld', p_manual_pool_wld,
      'actor_id', p_actor_id
    );
  ELSE
    SELECT COALESCE((value)::numeric, 0.1)
    INTO v_rate
    FROM public.global_game_settings
    WHERE key = 'diamond_wld_exchange_rate';

    v_target_pool := v_total_diamonds * v_rate;
    v_pool_rule := 'diamond_rate';
    v_pool_input := jsonb_build_object(
      'exchange_rate', v_rate
    );
  END IF;

  v_remaining_pool := GREATEST(0, v_target_pool);
  v_idx := 0;

  FOR v_req IN
    SELECT id, user_id, diamonds_submitted
    FROM public.cashout_requests
    WHERE payout_round_id = p_round_id
      AND status IN ('pending', 'approved')
    ORDER BY requested_at ASC, id ASC
  LOOP
    v_idx := v_idx + 1;

    IF v_total_diamonds > 0 THEN
      v_share := COALESCE(v_req.diamonds_submitted, 0) / v_total_diamonds;
      v_payout := v_target_pool * v_share;
    ELSE
      v_payout := 0;
    END IF;

    IF v_idx = v_total_count THEN
      v_payout := GREATEST(0, v_remaining_pool);
    END IF;

    v_remaining_pool := GREATEST(0, v_remaining_pool - v_payout);

    INSERT INTO public.cashout_payouts (
      round_id,
      user_id,
      diamonds_burned,
      payout_wld,
      status,
      processing_started_at,
      last_attempt_at,
      attempt_count,
      last_error,
      updated_at
    ) VALUES (
      p_round_id,
      v_req.user_id,
      v_req.diamonds_submitted,
      v_payout,
      'pending',
      NULL,
      NULL,
      0,
      NULL,
      now()
    )
    ON CONFLICT (round_id, user_id)
    DO UPDATE SET
      diamonds_burned = EXCLUDED.diamonds_burned,
      payout_wld = EXCLUDED.payout_wld,
      status = CASE
        WHEN cashout_payouts.status = 'paid' THEN 'paid'
        ELSE 'pending'
      END,
      processing_started_at = NULL,
      last_error = NULL,
      updated_at = now();
  END LOOP;

  UPDATE public.cashout_requests
  SET status = 'approved',
      processed_at = now()
  WHERE payout_round_id = p_round_id
    AND status = 'pending';

  UPDATE public.cashout_rounds
  SET status = 'closed',
      total_diamonds = v_total_diamonds,
      payout_pool_wld = v_target_pool,
      pool_rule = v_pool_rule,
      pool_rule_input = v_pool_input,
      finalized_at = COALESCE(finalized_at, now()),
      updated_at = now()
  WHERE id = p_round_id;

  RETURN jsonb_build_object(
    'ok', true,
    'round_id', p_round_id,
    'status', 'closed',
    'total_diamonds', v_total_diamonds,
    'payout_pool', v_target_pool,
    'pool_rule', v_pool_rule,
    'message', format('Processed %s request(s) successfully.', v_total_count)
  );
END;
$$;

-- 4) Recalculate closed round payouts
CREATE OR REPLACE FUNCTION public.recalculate_cashout_round(
  p_round_id UUID,
  p_manual_pool_wld NUMERIC,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_round public.cashout_rounds%ROWTYPE;
  v_total_diamonds NUMERIC := 0;
  v_total_count INTEGER := 0;
  v_idx INTEGER := 0;
  v_remaining_pool NUMERIC := 0;
  v_share NUMERIC := 0;
  v_payout NUMERIC := 0;
  v_row RECORD;
BEGIN
  IF p_manual_pool_wld IS NULL OR p_manual_pool_wld < 0 THEN
    RAISE EXCEPTION 'Valid manual_pool_wld is required for recalculation';
  END IF;

  SELECT *
  INTO v_round
  FROM public.cashout_rounds
  WHERE id = p_round_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found: %', p_round_id;
  END IF;

  IF v_round.status NOT IN ('closed', 'paid') THEN
    RAISE EXCEPTION 'Round % must be closed/paid for recalculation', p_round_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cashout_payouts
    WHERE round_id = p_round_id
      AND status = 'paid'
  ) THEN
    RAISE EXCEPTION 'Cannot recalculate after payouts are paid';
  END IF;

  SELECT COALESCE(SUM(diamonds_burned), 0), COUNT(*)
  INTO v_total_diamonds, v_total_count
  FROM public.cashout_payouts
  WHERE round_id = p_round_id;

  IF v_total_count = 0 THEN
    UPDATE public.cashout_rounds
    SET payout_pool_wld = p_manual_pool_wld,
        pool_rule = 'manual_override',
        pool_rule_input = jsonb_build_object(
          'manual_pool_wld', p_manual_pool_wld,
          'actor_id', p_actor_id,
          'recalculated', true
        ),
        updated_at = now()
    WHERE id = p_round_id;

    RETURN jsonb_build_object(
      'ok', true,
      'message', 'Pool updated, but no payouts to recalculate.',
      'round_id', p_round_id,
      'total_diamonds', v_total_diamonds,
      'payout_pool', p_manual_pool_wld
    );
  END IF;

  v_remaining_pool := p_manual_pool_wld;
  v_idx := 0;

  FOR v_row IN
    SELECT id, diamonds_burned
    FROM public.cashout_payouts
    WHERE round_id = p_round_id
    ORDER BY created_at ASC, id ASC
  LOOP
    v_idx := v_idx + 1;
    IF v_total_diamonds > 0 THEN
      v_share := COALESCE(v_row.diamonds_burned, 0) / v_total_diamonds;
      v_payout := p_manual_pool_wld * v_share;
    ELSE
      v_payout := 0;
    END IF;

    IF v_idx = v_total_count THEN
      v_payout := GREATEST(0, v_remaining_pool);
    END IF;

    v_remaining_pool := GREATEST(0, v_remaining_pool - v_payout);

    UPDATE public.cashout_payouts
    SET payout_wld = v_payout,
        status = 'pending',
        processing_started_at = NULL,
        last_error = NULL,
        tx_hash = NULL,
        updated_at = now()
    WHERE id = v_row.id;
  END LOOP;

  UPDATE public.cashout_rounds
  SET payout_pool_wld = p_manual_pool_wld,
      pool_rule = 'manual_override',
      pool_rule_input = jsonb_build_object(
        'manual_pool_wld', p_manual_pool_wld,
        'actor_id', p_actor_id,
        'recalculated', true
      ),
      status = 'closed',
      paid_at = NULL,
      updated_at = now()
  WHERE id = p_round_id;

  RETURN jsonb_build_object(
    'ok', true,
    'round_id', p_round_id,
    'total_diamonds', v_total_diamonds,
    'payout_pool', p_manual_pool_wld,
    'message', format('Recalculated %s payout(s) successfully.', v_total_count)
  );
END;
$$;

-- 5) Claim payout batch for idempotent execution
CREATE OR REPLACE FUNCTION public.claim_cashout_payout_batch(
  p_round_id UUID,
  p_limit INTEGER DEFAULT 25,
  p_retry_failed BOOLEAN DEFAULT false
)
RETURNS TABLE (
  payout_id UUID,
  user_id UUID,
  payout_wld NUMERIC,
  diamonds_burned NUMERIC,
  wallet_address TEXT,
  attempt_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH target AS (
    SELECT cp.id
    FROM public.cashout_payouts cp
    WHERE cp.round_id = p_round_id
      AND (
        cp.status = 'pending'
        OR (p_retry_failed AND cp.status = 'failed')
      )
    ORDER BY cp.created_at ASC, cp.id ASC
    LIMIT GREATEST(1, COALESCE(p_limit, 25))
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.cashout_payouts cp
    SET status = 'processing',
        processing_started_at = now(),
        last_attempt_at = now(),
        attempt_count = cp.attempt_count + 1,
        updated_at = now()
    FROM target t
    WHERE cp.id = t.id
    RETURNING cp.*
  )
  SELECT
    c.id AS payout_id,
    c.user_id,
    c.payout_wld,
    c.diamonds_burned,
    p.wallet_address,
    c.attempt_count
  FROM claimed c
  LEFT JOIN public.profiles p ON p.id = c.user_id;
END;
$$;

-- 6) Promote round to paid if terminal
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

GRANT EXECUTE ON FUNCTION public.finalize_cashout_round(UUID, NUMERIC, UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.recalculate_cashout_round(UUID, NUMERIC, UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.claim_cashout_payout_batch(UUID, INTEGER, BOOLEAN) TO anon;
GRANT EXECUTE ON FUNCTION public.complete_cashout_round_if_done(UUID) TO anon;
