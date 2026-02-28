# Edge Function & DB Diagnostics

Use this when the app hangs on loading or shows "Request to edge function failed" / "Request timed out".

## 1. Check game-state logs (Supabase Dashboard)

1. Open **Supabase Dashboard** → **Edge Functions** → **game-state** → **Logs**.
2. After reproducing the issue, look for lines like:
   - `[game-state] auth: 120ms`
   - `[game-state] getGameConfig: 450ms`
   - `[game-state] processMining: 3200ms`
   - `[game-state] profile+referral+cashout: 80ms`
   - `[game-state] total: 3850ms`

**What to look for:**

- **auth** > 2–3s: Session lookup slow or app_sessions table large; ensure index on `token` (PRIMARY KEY is enough).
- **getGameConfig** > 2–3s: Config or related tables (game_config, machine_tiers, mineral_configs, global_game_settings) slow or missing; run migrations.
- **processMining** > 10–15s: Likely DB lock contention (e.g. another request updating same user’s player_state/machines) or cold DB; check for long-running queries in **Database** → **Query Performance**.
- **total** near 28s+: Request may hit the client timeout; improve the slow step above or increase client timeout.
- **No logs at all**: Request never reached the function (cold start, network, or wrong URL). Consider a cron to warm the function every 5 minutes.

If you see `[game-state] error: <message>` then the function failed; the `<message>` is returned to the client (e.g. "Missing game_config", "Invalid session token", "Failed to create player state").

## 2. Check database state

Run in **SQL Editor** (as a sanity check):

```sql
-- Must return one row with key 'current'
SELECT key FROM public.game_config WHERE key = 'current';

-- Check player_state has expected columns (no error = OK)
SELECT user_id, oil_balance, diamond_balance, purchased_slots, last_active_at
FROM public.player_state LIMIT 1;

-- Check app_sessions (session lookup)
SELECT COUNT(*) FROM public.app_sessions;
```

- If `game_config` has no row for `current`, run the migration that restores it: `20260210160000_restore_game_config.sql` (or re-apply that INSERT).
- If the `player_state` query errors (e.g. column does not exist), apply missing migrations (e.g. `20260209090000_machine_slots.sql` for `purchased_slots`, `20260211000000_add_ux_columns.sql` for UX columns).

## 3. Common causes

| Symptom | Likely cause | Action |
|--------|----------------|--------|
| Loading forever, then timeout | Edge cold start or slow processMining | Check logs for timing; warm function or optimize slow step |
| "Missing game_config" | No row in game_config for key `current` | Run restore_game_config migration or insert |
| "Invalid session token" / "Session expired" | Bad or expired x-app-session | Re-login; check session storage (IndexedDB/localStorage/cookie) |
| "Failed to create player state" | Insert failed (e.g. profile missing, constraint) | Ensure auth-complete runs first and profile exists for user_id |
| "Failed to update machines" | player_machines upsert failed (e.g. missing column) | Apply machine_action_remainder and related migrations |

## 4. Redeploy and migrations

After code or schema changes:

```bash
# Push DB migrations
supabase db push

# Deploy edge functions
supabase functions deploy game-state
# or deploy all: supabase functions deploy
```
