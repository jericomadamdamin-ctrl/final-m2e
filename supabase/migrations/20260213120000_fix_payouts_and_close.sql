-- Fix payouts for round 612beddd at 1 diamond = 0.02 WLD rate
-- Total: 1534 diamonds = 30.68 WLD

-- 1. Update exchange rate to 0.02
UPDATE global_game_settings
SET value = 0.02
WHERE key = 'diamond_wld_exchange_rate';

-- 2. Close round 612beddd with correct pool
UPDATE cashout_rounds
SET status = 'closed',
    payout_pool_wld = 30.68,
    total_diamonds = 1534
WHERE id = '612beddd-cf02-4918-a713-191b23fe971c';

-- 3. Upsert payout records for the 3 approved users
INSERT INTO cashout_payouts (round_id, user_id, diamonds_burned, payout_wld, status)
VALUES
  ('612beddd-cf02-4918-a713-191b23fe971c', '1031bb2f-9df9-425b-a3d3-2f6d528cf922', 290, 5.80, 'pending'),
  ('612beddd-cf02-4918-a713-191b23fe971c', 'b6e5009d-859f-4668-beed-0624e18b1422', 1014, 20.28, 'pending'),
  ('612beddd-cf02-4918-a713-191b23fe971c', 'e1d3b0fc-ca9c-4059-9a67-553c2d979bcc', 230, 4.60, 'pending')
ON CONFLICT (round_id, user_id)
DO UPDATE SET
  payout_wld = EXCLUDED.payout_wld,
  diamonds_burned = EXCLUDED.diamonds_burned,
  status = 'pending';

-- 4. Close stale round 4b215b0f (Feb 8, 100 diamonds, already processed)
UPDATE cashout_rounds
SET status = 'closed'
WHERE id = '4b215b0f-92fb-466d-8819-c236a68aadbb'
  AND status = 'open';
