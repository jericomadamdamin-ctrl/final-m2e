-- Phase 2-5: Session Security & Anti-Cheat Infrastructure

-- Add session fingerprinting columns
ALTER TABLE public.app_sessions 
ADD COLUMN IF NOT EXISTS device_fingerprint TEXT,
ADD COLUMN IF NOT EXISTS ip_address TEXT,
ADD COLUMN IF NOT EXISTS user_agent TEXT,
ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
ADD COLUMN IF NOT EXISTS is_revoked BOOLEAN NOT NULL DEFAULT false;

-- Create index for session lookups
CREATE INDEX IF NOT EXISTS idx_app_sessions_last_used ON public.app_sessions(last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_sessions_revoked ON public.app_sessions(is_revoked) WHERE is_revoked = false;

-- Suspicious activity tracking
CREATE TABLE IF NOT EXISTS public.suspicious_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  details JSONB DEFAULT '{}',
  session_id UUID,
  ip_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suspicious_activity_user ON public.suspicious_activity(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suspicious_activity_type ON public.suspicious_activity(activity_type);

ALTER TABLE public.suspicious_activity ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN 
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Suspicious activity admin read' AND tablename = 'suspicious_activity'
  ) THEN
    CREATE POLICY "Suspicious activity admin read"
    ON public.suspicious_activity FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true));
  END IF;
END $$;

-- Shadow ban table (soft flags before hard bans)
CREATE TABLE IF NOT EXISTS public.player_flags (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_shadow_banned BOOLEAN NOT NULL DEFAULT false,
  shadow_ban_reason TEXT,
  shadow_ban_at TIMESTAMP WITH TIME ZONE,
  is_rate_limited BOOLEAN NOT NULL DEFAULT false,
  rate_limit_multiplier NUMERIC NOT NULL DEFAULT 1,
  anomaly_score NUMERIC NOT NULL DEFAULT 0,
  last_anomaly_check TIMESTAMP WITH TIME ZONE,
  notes JSONB DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.player_flags ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN 
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Player flags admin only' AND tablename = 'player_flags'
  ) THEN
    CREATE POLICY "Player flags admin only"
    ON public.player_flags FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true));
  END IF;
END $$;

-- Idempotency keys for API protection (Phase 3)
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  key TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  response JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires ON public.idempotency_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_user ON public.idempotency_keys(user_id);

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Player statistics for anomaly detection (Phase 4)
CREATE TABLE IF NOT EXISTS public.player_statistics (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  total_actions INTEGER NOT NULL DEFAULT 0,
  total_oil_earned NUMERIC NOT NULL DEFAULT 0,
  total_oil_spent NUMERIC NOT NULL DEFAULT 0,
  total_diamonds_earned NUMERIC NOT NULL DEFAULT 0,
  total_diamonds_cashed_out NUMERIC NOT NULL DEFAULT 0,
  total_purchases NUMERIC NOT NULL DEFAULT 0,
  purchase_volume_wld NUMERIC NOT NULL DEFAULT 0,
  first_action_at TIMESTAMP WITH TIME ZONE,
  last_action_at TIMESTAMP WITH TIME ZONE,
  avg_actions_per_day NUMERIC,
  win_rate NUMERIC,
  anomaly_flags JSONB DEFAULT '[]',
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.player_statistics ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN 
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Player stats self read' AND tablename = 'player_statistics'
  ) THEN
    CREATE POLICY "Player stats self read"
    ON public.player_statistics FOR SELECT
    USING (user_id = auth.uid());
  END IF;
END $$;

DO $$ 
BEGIN 
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Player stats admin all' AND tablename = 'player_statistics'
  ) THEN
    CREATE POLICY "Player stats admin all"
    ON public.player_statistics FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true));
  END IF;
END $$;

-- Function to update player statistics
CREATE OR REPLACE FUNCTION update_player_stats(
  p_user_id UUID,
  p_action_count INTEGER DEFAULT 1,
  p_oil_earned NUMERIC DEFAULT 0,
  p_oil_spent NUMERIC DEFAULT 0,
  p_diamonds_earned NUMERIC DEFAULT 0
)
RETURNS void AS $$
BEGIN
  INSERT INTO player_statistics (user_id, total_actions, total_oil_earned, total_oil_spent, total_diamonds_earned, first_action_at, last_action_at)
  VALUES (p_user_id, p_action_count, p_oil_earned, p_oil_spent, p_diamonds_earned, now(), now())
  ON CONFLICT (user_id) DO UPDATE SET
    total_actions = player_statistics.total_actions + p_action_count,
    total_oil_earned = player_statistics.total_oil_earned + p_oil_earned,
    total_oil_spent = player_statistics.total_oil_spent + p_oil_spent,
    total_diamonds_earned = player_statistics.total_diamonds_earned + p_diamonds_earned,
    last_action_at = now(),
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Cleanup job for expired idempotency keys (run via cron)
CREATE OR REPLACE FUNCTION cleanup_expired_keys()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM idempotency_keys WHERE expires_at < now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  DELETE FROM rate_limits WHERE window_start < now() - interval '1 hour';
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
