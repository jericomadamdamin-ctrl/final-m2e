-- Configurable cashout tax applied at payout finalization/recalculation.
-- Tax value source: game_config.current -> cashout.tax_rate_percent (default 30).

UPDATE public.game_config
SET value = jsonb_set(
  COALESCE(value, '{}'::jsonb),
  '{cashout,tax_rate_percent}',
  to_jsonb(
    COALESCE(
      NULLIF(value -> 'cashout' ->> 'tax_rate_percent', '')::numeric,
      30
    )
  ),
  true
)
WHERE key = 'current';

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
  v_tax_rate_percent NUMERIC := 30;
  v_tax_rate NUMERIC := 0.3;
  v_tax_amount NUMERIC := 0;
  v_total_diamonds NUMERIC := 0;
  v_gross_pool NUMERIC := 0;
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

  SELECT COALESCE(NULLIF(value -> 'cashout' ->> 'tax_rate_percent', '')::numeric, 30)
  INTO v_tax_rate_percent
  FROM public.game_config
  WHERE key = 'current';

  v_tax_rate := LEAST(GREATEST(COALESCE(v_tax_rate_percent, 30) / 100.0, 0), 1);

  IF p_manual_pool_wld IS NOT NULL THEN
    v_gross_pool := p_manual_pool_wld;
    v_pool_rule := 'manual_override';
  ELSE
    SELECT COALESCE((value)::numeric, 0.1)
    INTO v_rate
    FROM public.global_game_settings
    WHERE key = 'diamond_wld_exchange_rate';

    v_gross_pool := v_total_diamonds * v_rate;
    v_pool_rule := 'diamond_rate';
  END IF;

  v_tax_amount := GREATEST(0, v_gross_pool) * v_tax_rate;
  v_target_pool := GREATEST(0, v_gross_pool - v_tax_amount);

  v_pool_input := jsonb_build_object(
    'tax_rate_percent', v_tax_rate * 100,
    'gross_pool_wld', v_gross_pool,
    'tax_amount_wld', v_tax_amount,
    'net_pool_wld', v_target_pool
  );

  IF p_manual_pool_wld IS NOT NULL THEN
    v_pool_input := v_pool_input || jsonb_build_object(
      'manual_pool_wld', p_manual_pool_wld,
      'actor_id', p_actor_id
    );
  ELSE
    v_pool_input := v_pool_input || jsonb_build_object(
      'exchange_rate', v_rate
    );
  END IF;

  v_remaining_pool := v_target_pool;
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
    'gross_pool_wld', v_gross_pool,
    'tax_amount_wld', v_tax_amount,
    'tax_rate_percent', v_tax_rate * 100,
    'payout_pool', v_target_pool,
    'pool_rule', v_pool_rule,
    'message', format('Processed %s request(s) successfully.', v_total_count)
  );
END;
$$;

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
  v_tax_rate_percent NUMERIC := 30;
  v_tax_rate NUMERIC := 0.3;
  v_tax_amount NUMERIC := 0;
  v_target_pool NUMERIC := 0;
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

  SELECT COALESCE(NULLIF(value -> 'cashout' ->> 'tax_rate_percent', '')::numeric, 30)
  INTO v_tax_rate_percent
  FROM public.game_config
  WHERE key = 'current';

  v_tax_rate := LEAST(GREATEST(COALESCE(v_tax_rate_percent, 30) / 100.0, 0), 1);
  v_tax_amount := GREATEST(0, p_manual_pool_wld) * v_tax_rate;
  v_target_pool := GREATEST(0, p_manual_pool_wld - v_tax_amount);

  SELECT COALESCE(SUM(diamonds_burned), 0), COUNT(*)
  INTO v_total_diamonds, v_total_count
  FROM public.cashout_payouts
  WHERE round_id = p_round_id;

  IF v_total_count = 0 THEN
    UPDATE public.cashout_rounds
    SET payout_pool_wld = v_target_pool,
        pool_rule = 'manual_override',
        pool_rule_input = jsonb_build_object(
          'manual_pool_wld', p_manual_pool_wld,
          'actor_id', p_actor_id,
          'recalculated', true,
          'tax_rate_percent', v_tax_rate * 100,
          'gross_pool_wld', p_manual_pool_wld,
          'tax_amount_wld', v_tax_amount,
          'net_pool_wld', v_target_pool
        ),
        updated_at = now()
    WHERE id = p_round_id;

    RETURN jsonb_build_object(
      'ok', true,
      'message', 'Pool updated, but no payouts to recalculate.',
      'round_id', p_round_id,
      'total_diamonds', v_total_diamonds,
      'gross_pool_wld', p_manual_pool_wld,
      'tax_amount_wld', v_tax_amount,
      'tax_rate_percent', v_tax_rate * 100,
      'payout_pool', v_target_pool
    );
  END IF;

  v_remaining_pool := v_target_pool;
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
      v_payout := v_target_pool * v_share;
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
  SET payout_pool_wld = v_target_pool,
      pool_rule = 'manual_override',
      pool_rule_input = jsonb_build_object(
        'manual_pool_wld', p_manual_pool_wld,
        'actor_id', p_actor_id,
        'recalculated', true,
        'tax_rate_percent', v_tax_rate * 100,
        'gross_pool_wld', p_manual_pool_wld,
        'tax_amount_wld', v_tax_amount,
        'net_pool_wld', v_target_pool
      ),
      status = 'closed',
      paid_at = NULL,
      updated_at = now()
  WHERE id = p_round_id;

  RETURN jsonb_build_object(
    'ok', true,
    'round_id', p_round_id,
    'total_diamonds', v_total_diamonds,
    'gross_pool_wld', p_manual_pool_wld,
    'tax_amount_wld', v_tax_amount,
    'tax_rate_percent', v_tax_rate * 100,
    'payout_pool', v_target_pool,
    'message', format('Recalculated %s payout(s) successfully.', v_total_count)
  );
END;
$$;
