-- Grant Execute to ANON role for debugging via script
GRANT EXECUTE ON FUNCTION public.get_cashout_stats() TO anon;
