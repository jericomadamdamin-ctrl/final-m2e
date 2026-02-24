-- Restore game_config (if missing or deleted)

INSERT INTO public.game_config (key, value)
VALUES (
  'current',
  jsonb_build_object(
    'system', jsonb_build_object(
      'name', 'Mine to Earn',
      'mode', 'backend_managed',
      'smart_contracts', false,
      'goal', 'Run a long-term idle mining game where player payouts are strictly bounded by real revenue.'
    ),
    'currencies', jsonb_build_object(
      'external', jsonb_build_array('WLD','USDC'),
      'internal', jsonb_build_object(
        'OIL', jsonb_build_object(
          'type', 'credit',
          'withdrawable', false,
          'source', jsonb_build_array('purchase','mining_conversion'),
          'uses', jsonb_build_array('machine_purchase','fuel','upgrades')
        ),
        'DIAMOND', jsonb_build_object(
          'type', 'claim_weight',
          'withdrawable', false,
          'burn_on_cashout', true
        )
      )
    ),
    'pricing', jsonb_build_object(
      'oil_per_wld', 1000,
      'oil_per_usdc', 1000,
      'admin_editable', true,
      'usdc_to_wld_rate', 1
    ),
    'machines', jsonb_build_object(
      'mini', jsonb_build_object('cost_oil',100,'speed_actions_per_hour',2,'oil_burn_per_hour',5,'tank_capacity',5,'max_level',10),
      'light', jsonb_build_object('cost_oil',500,'speed_actions_per_hour',5,'oil_burn_per_hour',10,'tank_capacity',10,'max_level',10),
      'heavy', jsonb_build_object('cost_oil',2000,'speed_actions_per_hour',12,'oil_burn_per_hour',20,'tank_capacity',20,'max_level',10),
      'mega', jsonb_build_object('cost_oil',10000,'speed_actions_per_hour',30,'oil_burn_per_hour',50,'tank_capacity',50,'max_level',10)
    ),
    'mining', jsonb_build_object(
      'simulation', 'server_side_only',
      'oil_consumption_model', 'per_hour',
      'action_rewards', jsonb_build_object(
        'minerals', jsonb_build_object(
          'bronze', jsonb_build_object('drop_rate',0.40,'oil_value',2),
          'silver', jsonb_build_object('drop_rate',0.25,'oil_value',5),
          'gold', jsonb_build_object('drop_rate',0.18,'oil_value',10),
          'iron', jsonb_build_object('drop_rate',0.15,'oil_value',8)
        ),
        'diamond', jsonb_build_object('drop_rate_per_action',0.02)
      )
    ),
    'progression', jsonb_build_object(
      'level_speed_multiplier', 0.10,
      'level_oil_burn_multiplier', 0.10,
      'level_capacity_multiplier', 0.05,
      'upgrade_cost_multiplier', 0.50
    ),
    'diamond_controls', jsonb_build_object(
      'daily_cap_per_user', 1,
      'excess_conversion', 'convert_to_oil',
      'admin_adjustable', true,
      'excess_diamond_oil_value', 50
    ),
    'revenue_tracking', jsonb_build_object(
      'sources', jsonb_build_array('oil_purchases'),
      'currency', 'WLD',
      'window', 'last_24_hours'
    ),
    'cashout', jsonb_build_object(
      'enabled', true,
      'minimum_diamonds_required', 100,
      'round_frequency', 'daily',
      'cooldown_days', 14,
      'payout_model', 'revenue_bounded'
    ),
    'treasury', jsonb_build_object(
      'payout_percentage', 0.5,
      'calculation', 'payout_pool = payout_percentage * last_24h_revenue',
      'hard_rule', 'total_payouts_must_not_exceed_payout_pool',
      'treasury_address', null
    ),
    'cashout_distribution', jsonb_build_object(
      'formula', 'user_payout = (user_diamonds / total_submitted_diamonds) * payout_pool',
      'diamond_burn', true,
      'partial_payouts_allowed', true
    ),
    'anti_abuse', jsonb_build_object(
      'server_authoritative', true,
      'client_trust', false,
      'no_negative_balances', true,
      'rate_limits', jsonb_build_object('cashout_requests_per_day',1),
      'bot_mitigation', jsonb_build_object('diamond_cap', true, 'cooldown_enforced', true)
    ),
    'admin_controls', jsonb_build_object(
      'editable_parameters', jsonb_build_array(
        'oil_per_wld','oil_per_usdc','diamond_drop_rate','daily_diamond_cap_per_user','treasury_payout_percentage','cashout_cooldown_days'
      ),
      'live_update', true,
      'no_balance_reset_required', true
    ),
    'invariants', jsonb_build_array(
      'total_wld_paid_out <= total_wld_collected * treasury_payout_percentage',
      'oil_is_not_withdrawable',
      'diamonds_do_not_guarantee_wld',
      'all_mining_rewards_are_server_calculated'
    ),
    'player_messaging_rules', jsonb_build_object(
      'no_fixed_roi_promises', true,
      'diamonds_described_as', 'claim_power',
      'wld_described_as', 'community_reward_pool',
      'payouts_depend_on_revenue', true
    )
  )
)
ON CONFLICT (key) DO NOTHING;
