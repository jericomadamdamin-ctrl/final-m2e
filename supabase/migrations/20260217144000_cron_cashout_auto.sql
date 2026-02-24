-- Schedule autonomous cashout processing worker.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Run every 2 minutes.
SELECT cron.schedule(
  'cashout-auto-worker',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kinfgzrpwdoroahsnzbr.supabase.co/functions/v1/cron-cashout-auto',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpbmZnenJwd2Rvcm9haHNuemJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzODczNjAsImV4cCI6MjA4NTk2MzM2MH0.UL-wSEuUPuDSk22HSWjfJVx9N1q0bjuJqvaHoZOb7HA',
      'x-cron-key',   'cron_cashout_auto_replace_me'
    ),
    body    := '{"source":"pg_cron"}'::jsonb
  );
  $$
);
