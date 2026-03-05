-- Backfill a free 'mini' machine for existing users who registered before
-- the free starter machine fix and currently have 0 machines.
INSERT INTO public.player_machines (user_id, type, level, fuel_oil)
SELECT p.id, 'mini', 1, 5
FROM public.profiles p
LEFT JOIN public.player_machines pm ON p.id = pm.user_id
WHERE pm.id IS NULL;
