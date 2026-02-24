-- Phase 0: Security Baseline - Tables Only
-- Security events audit table and feature flags

-- Security Events Table (audit trail)
CREATE TABLE IF NOT EXISTS public.security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  action TEXT,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for querying recent events
CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON public.security_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON public.security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON public.security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON public.security_events(severity);

-- Enable RLS (only admins can read security events)
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Security events admin read" ON public.security_events;
CREATE POLICY "Security events admin read"
ON public.security_events FOR SELECT
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true));

-- Feature Flags Table (kill switches)
CREATE TABLE IF NOT EXISTS public.feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB DEFAULT '{}',
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Feature flags read" ON public.feature_flags;
CREATE POLICY "Feature flags read"
ON public.feature_flags FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Feature flags admin write" ON public.feature_flags;
CREATE POLICY "Feature flags admin write"
ON public.feature_flags FOR ALL
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true));

-- Seed default feature flags
INSERT INTO public.feature_flags (key, enabled, metadata) VALUES
  ('cashout_enabled', true, '{"description": "Master switch for cashout functionality"}'),
  ('referral_enabled', true, '{"description": "Enable referral bonus system"}'),
  ('oil_purchase_enabled', true, '{"description": "Enable oil purchases"}'),
  ('game_actions_enabled', true, '{"description": "Enable all game actions"}'),
  ('strict_rate_limiting', false, '{"description": "Enable strict API rate limiting"}'),
  ('shadow_ban_detection', false, '{"description": "Enable anomaly detection and shadow banning"}')
ON CONFLICT (key) DO NOTHING;

-- Rate limiting table
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  request_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE(user_id, action, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup 
ON public.rate_limits(user_id, action, window_start DESC);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
