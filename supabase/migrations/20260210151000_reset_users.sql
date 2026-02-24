-- Reset Users and Verifications (Keep Config Only)

-- Truncate profiles (application-level users) and verifications
TRUNCATE TABLE 
  public.profiles,
  public.world_id_verifications
RESTART IDENTITY CASCADE;

-- Note: This does NOT delete auth.users (Supabase Auth). 
-- Users can still sign in, but they will have new empty profiles created if headers/triggers logic handles it.
-- If you need to wipe auth.users, you typically need to do that via the Supabase Dashboard or a separate script with elevated privileges.
-- But for the game state, clearing 'profiles' effectively resets their existence in the game.
