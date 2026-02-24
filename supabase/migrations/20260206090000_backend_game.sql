-- Backend-managed game economy schema (World App mini-app)

-- Extend profiles for wallet + verification + admin
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS wallet_address TEXT,
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS is_human_verified BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS human_verified_at TIMESTAMP WITH TIME ZONE;

-- Game configuration (single row JSON config)
CREATE TABLE IF NOT EXISTS public.game_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.game_config ENABLE ROW LEVEL SECURITY;

-- Player state (authoritative balances)
CREATE TABLE IF NOT EXISTS public.player_state (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  oil_balance NUMERIC NOT NULL DEFAULT 0,
  diamond_balance NUMERIC NOT NULL DEFAULT 0,
  minerals JSONB NOT NULL DEFAULT '{"bronze":0,"silver":0,"gold":0,"iron":0}',
  daily_diamond_count NUMERIC NOT NULL DEFAULT 0,
  daily_diamond_reset_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_active_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.player_state ENABLE ROW LEVEL SECURITY;

-- Player machines (authoritative)
CREATE TABLE IF NOT EXISTS public.player_machines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('mini','light','heavy','mega')),
  level INTEGER NOT NULL DEFAULT 1,
  fuel_oil NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT false,
  last_processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.player_machines ENABLE ROW LEVEL SECURITY;

-- World ID verifications (anti-replay + audit)
CREATE TABLE IF NOT EXISTS public.world_id_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  nullifier_hash TEXT NOT NULL UNIQUE,
  verification_level TEXT NOT NULL,
  verified_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.world_id_verifications ENABLE ROW LEVEL SECURITY;

-- Oil purchases (revenue source)
CREATE TABLE IF NOT EXISTS public.oil_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token TEXT NOT NULL CHECK (token IN ('WLD','USDC')),
  amount_token NUMERIC NOT NULL,
  amount_oil NUMERIC NOT NULL,
  amount_wld NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','failed')),
  reference TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.oil_purchases ENABLE ROW LEVEL SECURITY;

-- Cashout rounds (daily)
CREATE TABLE IF NOT EXISTS public.cashout_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_date DATE NOT NULL UNIQUE,
  revenue_window_start TIMESTAMP WITH TIME ZONE NOT NULL,
  revenue_window_end TIMESTAMP WITH TIME ZONE NOT NULL,
  revenue_wld NUMERIC NOT NULL DEFAULT 0,
  payout_pool_wld NUMERIC NOT NULL DEFAULT 0,
  total_diamonds NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','paid')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.cashout_rounds ENABLE ROW LEVEL SECURITY;

-- Cashout requests
CREATE TABLE IF NOT EXISTS public.cashout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  diamonds_submitted NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','rejected')),
  payout_round_id UUID REFERENCES public.cashout_rounds(id) ON DELETE SET NULL,
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  processed_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.cashout_requests ENABLE ROW LEVEL SECURITY;

-- Cashout payouts
CREATE TABLE IF NOT EXISTS public.cashout_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES public.cashout_rounds(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  diamonds_burned NUMERIC NOT NULL,
  payout_wld NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.cashout_payouts ENABLE ROW LEVEL SECURITY;

-- Updated-at trigger function (reuse existing if present)
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Attach updated_at triggers
DROP TRIGGER IF EXISTS touch_player_state ON public.player_state;
CREATE TRIGGER touch_player_state
BEFORE UPDATE ON public.player_state
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_player_machines ON public.player_machines;
CREATE TRIGGER touch_player_machines
BEFORE UPDATE ON public.player_machines
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_game_config ON public.game_config;
CREATE TRIGGER touch_game_config
BEFORE UPDATE ON public.game_config
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

-- RLS policies

-- game_config: public read, admin write
CREATE POLICY "Game config read"
ON public.game_config FOR SELECT
USING (true);

CREATE POLICY "Game config admin write"
ON public.game_config FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true));

-- player_state: owner read/write
CREATE POLICY "Player state read"
ON public.player_state FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Player state insert"
ON public.player_state FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Player state update"
ON public.player_state FOR UPDATE
USING (auth.uid() = user_id);

-- player_machines: owner read/write
CREATE POLICY "Player machines read"
ON public.player_machines FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Player machines insert"
ON public.player_machines FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Player machines update"
ON public.player_machines FOR UPDATE
USING (auth.uid() = user_id);

-- world_id_verifications: owner read; insert via backend only
CREATE POLICY "World ID read"
ON public.world_id_verifications FOR SELECT
USING (auth.uid() = user_id);

-- oil_purchases: owner read/insert
CREATE POLICY "Oil purchases read"
ON public.oil_purchases FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Oil purchases insert"
ON public.oil_purchases FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- cashout: owner read/insert
CREATE POLICY "Cashout requests read"
ON public.cashout_requests FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Cashout requests insert"
ON public.cashout_requests FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- payouts: owner read
CREATE POLICY "Cashout payouts read"
ON public.cashout_payouts FOR SELECT
USING (auth.uid() = user_id);

-- rounds: public read
CREATE POLICY "Cashout rounds read"
ON public.cashout_rounds FOR SELECT
USING (true);

-- Seed game config if not exists
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
