-- Persist fractional mining progress so frequent polling doesn't lose actions.

ALTER TABLE public.player_machines
ADD COLUMN IF NOT EXISTS action_remainder NUMERIC NOT NULL DEFAULT 0;

