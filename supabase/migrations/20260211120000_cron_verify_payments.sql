-- Enable pg_cron and pg_net for scheduled HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Schedule: verify pending payments every 5 minutes.
-- Uses the anon key in Authorization (required by Supabase gateway) and
-- the CRON_VERIFY_SECRET in a custom header for function-level auth.
-- The function verifies pending purchases against the World Dev Portal API
-- and expires stale abandoned purchases older than 24 hours.
SELECT cron.schedule(
  'verify-pending-payments',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kinfgzrpwdoroahsnzbr.supabase.co/functions/v1/cron-verify-payments',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpbmZnenJwd2Rvcm9haHNuemJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzODczNjAsImV4cCI6MjA4NTk2MzM2MH0.UL-wSEuUPuDSk22HSWjfJVx9N1q0bjuJqvaHoZOb7HA',
      'x-cron-key',   'cron_verify_683b9ff24d4ca628aeb49e399473a574'
    ),
    body    := '{"source":"pg_cron"}'::jsonb
  );
  $$
);
