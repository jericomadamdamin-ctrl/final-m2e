-- Diagnostic RPC for inspecting cashout state
-- Returns JSONB with:
-- 1. Open round details
-- 2. Count of pending requests by payout_round_id
-- 3. Count of pending requests with NULL payout_round_id

CREATE OR REPLACE FUNCTION public.get_cashout_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_open_rounds JSONB;
  v_pending_counts JSONB;
  v_total_counts JSONB;
  v_latest_requests JSONB;
BEGIN

  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
  INTO v_open_rounds
  FROM cashout_rounds r
  WHERE r.status = 'open';

  SELECT COALESCE(jsonb_object_agg(COALESCE(payout_round_id::text, 'null'), count), '{}'::jsonb)
  INTO v_pending_counts
  FROM (
    SELECT payout_round_id, COUNT(*) as count
    FROM cashout_requests
    WHERE status = 'pending'
    GROUP BY payout_round_id
  ) t;

  SELECT COALESCE(jsonb_object_agg(status, count), '{}'::jsonb)
  INTO v_total_counts
  FROM (
    SELECT status, COUNT(*) as count
    FROM cashout_requests
    GROUP BY status
  ) s;
  
  SELECT COALESCE(jsonb_agg(to_jsonb(req)), '[]'::jsonb)
  INTO v_latest_requests
  FROM (
    SELECT id, user_id, payout_round_id, status, requested_at, diamonds_submitted
    FROM cashout_requests
    ORDER BY requested_at DESC
    LIMIT 5
  ) req;

  v_result := jsonb_build_object(
    'open_rounds', v_open_rounds,
    'pending_request_counts_by_round', v_pending_counts,
    'total_requests_all_status', v_total_counts,
    'latest_5_requests', v_latest_requests
  );


  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cashout_stats() TO anon;

