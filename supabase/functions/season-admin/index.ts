import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, requireUserId, requireAdminOrKey } from '../_shared/supabase.ts';

interface SeasonCreateBody {
  name: string;
  description?: string;
  duration_hours: number;
  reward_tiers?: Array<{ rank_from: number; rank_to: number; reward_wld: number; label: string }>;
  machine_pool_total?: number;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const userId = await requireUserId(req);
    await requireAdminOrKey(req, userId);

    const { action, ...body } = await req.json();
    if (!action) throw new Error('Missing action');

    const admin = getAdminClient();

    // ── LIST ──
    if (action === 'list') {
      const { data: seasons, error } = await admin
        .from('seasons')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const enriched = await Promise.all(
        (seasons ?? []).map(async (s: any) => {
          const { count: totalPlayers } = await admin
            .from('seasonal_leaderboard')
            .select('*', { count: 'exact', head: true })
            .eq('season_id', s.id);

          const { data: diamondAgg } = await admin
            .from('seasonal_leaderboard')
            .select('diamonds_collected')
            .eq('season_id', s.id);

          const totalDiamonds = (diamondAgg ?? []).reduce(
            (sum: number, r: any) => sum + Number(r.diamonds_collected || 0),
            0,
          );

          const { count: rewardCount } = await admin
            .from('season_rewards')
            .select('*', { count: 'exact', head: true })
            .eq('season_id', s.id);

          return {
            ...s,
            total_players: totalPlayers ?? 0,
            total_diamonds: totalDiamonds,
            reward_count: rewardCount ?? 0,
          };
        }),
      );

      return jsonResponse({ ok: true, seasons: enriched });
    }

    // ── CREATE ──
    if (action === 'create') {
      const { name, description, duration_hours, reward_tiers, machine_pool_total } = body as SeasonCreateBody;
      if (!name || !duration_hours || duration_hours <= 0) {
        throw new Error('name and positive duration_hours are required');
      }

      const poolTotal = Math.max(0, Math.floor(machine_pool_total ?? 0));
      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + duration_hours * 3600 * 1000);

      const { data: season, error } = await admin
        .from('seasons')
        .insert({
          name,
          description: description || null,
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          is_active: false,
          status: 'draft',
          reward_tiers: reward_tiers ?? [],
          created_by: userId,
          machine_pool_total: poolTotal,
          machine_pool_remaining: poolTotal,
        })
        .select('*')
        .single();

      if (error) throw error;
      return jsonResponse({ ok: true, season });
    }

    // ── ACTIVATE ──
    if (action === 'activate') {
      const { season_id } = body;
      if (!season_id) throw new Error('Missing season_id');

      const { data: target, error: fetchErr } = await admin
        .from('seasons')
        .select('*')
        .eq('id', season_id)
        .single();

      if (fetchErr || !target) throw new Error('Season not found');
      if (target.status !== 'draft') {
        throw new Error(`Cannot activate season in "${target.status}" status. Only draft seasons can be activated.`);
      }

      // End any currently active season
      const { data: activeSeason } = await admin
        .from('seasons')
        .select('id')
        .eq('status', 'active')
        .maybeSingle();

      if (activeSeason) {
        await admin
          .from('seasons')
          .update({ status: 'ended', is_active: false, ended_at: new Date().toISOString() })
          .eq('id', activeSeason.id);
      }

      // Activate the target season with fresh start/end times
      const now = new Date();
      const durationMs = new Date(target.end_time).getTime() - new Date(target.start_time).getTime();
      const newEnd = new Date(now.getTime() + durationMs);

      const { data: updated, error: updateErr } = await admin
        .from('seasons')
        .update({
          status: 'active',
          is_active: true,
          start_time: now.toISOString(),
          end_time: newEnd.toISOString(),
        })
        .eq('id', season_id)
        .select('*')
        .single();

      if (updateErr) throw updateErr;
      return jsonResponse({ ok: true, season: updated });
    }

    // ── END ──
    if (action === 'end') {
      const { season_id } = body;
      if (!season_id) throw new Error('Missing season_id');

      const { data: target } = await admin
        .from('seasons')
        .select('status')
        .eq('id', season_id)
        .single();

      if (!target) throw new Error('Season not found');
      if (target.status !== 'active') {
        throw new Error(`Cannot end season in "${target.status}" status. Only active seasons can be ended.`);
      }

      const { data: updated, error } = await admin
        .from('seasons')
        .update({
          status: 'ended',
          is_active: false,
          ended_at: new Date().toISOString(),
        })
        .eq('id', season_id)
        .select('*')
        .single();

      if (error) throw error;
      return jsonResponse({ ok: true, season: updated });
    }

    // ── DISTRIBUTE ──
    if (action === 'distribute') {
      const { season_id } = body;
      if (!season_id) throw new Error('Missing season_id');

      const { data: season } = await admin
        .from('seasons')
        .select('*')
        .eq('id', season_id)
        .single();

      if (!season) throw new Error('Season not found');
      if (season.status !== 'ended') {
        throw new Error(`Cannot distribute rewards for season in "${season.status}" status. Season must be ended first.`);
      }

      const rewardTiers = (season.reward_tiers ?? []) as Array<{
        rank_from: number;
        rank_to: number;
        reward_wld: number;
        label: string;
      }>;

      if (rewardTiers.length === 0) {
        throw new Error('No reward tiers configured for this season');
      }

      const maxRank = Math.max(...rewardTiers.map((t) => t.rank_to));

      const { data: topPlayers, error: lbErr } = await admin
        .from('seasonal_leaderboard')
        .select('user_id, diamonds_collected')
        .eq('season_id', season_id)
        .order('diamonds_collected', { ascending: false })
        .limit(maxRank);

      if (lbErr) throw lbErr;

      const rewards: Array<{
        season_id: string;
        user_id: string;
        rank: number;
        diamonds_collected: number;
        reward_wld: number;
        status: string;
      }> = [];

      (topPlayers ?? []).forEach((player: any, idx: number) => {
        const rank = idx + 1;
        const tier = rewardTiers.find((t) => rank >= t.rank_from && rank <= t.rank_to);
        if (tier) {
          rewards.push({
            season_id,
            user_id: player.user_id,
            rank,
            diamonds_collected: Number(player.diamonds_collected),
            reward_wld: tier.reward_wld,
            status: 'pending',
          });
        }
      });

      if (rewards.length > 0) {
        const { error: insertErr } = await admin
          .from('season_rewards')
          .upsert(rewards, { onConflict: 'season_id,user_id' });

        if (insertErr) throw insertErr;
      }

      await admin
        .from('seasons')
        .update({ status: 'rewarded' })
        .eq('id', season_id);

      return jsonResponse({ ok: true, rewards_created: rewards.length, rewards });
    }

    // ── LEADERBOARD ──
    if (action === 'leaderboard') {
      const { season_id } = body;
      if (!season_id) throw new Error('Missing season_id');

      const { data: lbData, error: lbErr } = await admin
        .from('seasonal_leaderboard')
        .select(`
          user_id,
          diamonds_collected,
          last_updated,
          profiles!inner(player_name, wallet_address)
        `)
        .eq('season_id', season_id)
        .order('diamonds_collected', { ascending: false })
        .limit(100);

      if (lbErr) throw lbErr;

      const { data: rewardsData } = await admin
        .from('season_rewards')
        .select('*')
        .eq('season_id', season_id)
        .order('rank', { ascending: true });

      const entries = (lbData ?? []).map((row: any, i: number) => ({
        rank: i + 1,
        user_id: row.user_id,
        player_name: row.profiles?.player_name ?? 'Unknown',
        wallet_address: row.profiles?.wallet_address ?? null,
        diamonds_collected: Number(row.diamonds_collected),
        last_updated: row.last_updated,
      }));

      return jsonResponse({ ok: true, entries, rewards: rewardsData ?? [] });
    }

    // ── UPDATE ── (edit draft/active season details)
    if (action === 'update') {
      const { season_id, name, description, reward_tiers, duration_hours, machine_pool_total } = body;
      if (!season_id) throw new Error('Missing season_id');

      const { data: target } = await admin
        .from('seasons')
        .select('status, start_time, end_time, machine_pool_total, machine_pool_remaining')
        .eq('id', season_id)
        .single();

      if (!target) throw new Error('Season not found');
      if (target.status !== 'draft' && target.status !== 'active') {
        throw new Error('Can only update draft or active seasons');
      }

      const patch: Record<string, unknown> = {};
      if (name !== undefined) patch.name = name;
      if (description !== undefined) patch.description = description;
      if (reward_tiers !== undefined) patch.reward_tiers = reward_tiers;
      if (duration_hours !== undefined && duration_hours > 0) {
        const start = new Date(target.start_time);
        patch.end_time = new Date(start.getTime() + duration_hours * 3600 * 1000).toISOString();
      }
      if (machine_pool_total !== undefined) {
        const newTotal = Math.max(0, Math.floor(machine_pool_total));
        const oldTotal = Number(target.machine_pool_total ?? 0);
        const oldRemaining = Number(target.machine_pool_remaining ?? 0);
        const delta = newTotal - oldTotal;
        patch.machine_pool_total = newTotal;
        patch.machine_pool_remaining = Math.max(0, oldRemaining + delta);
      }

      const { data: updated, error } = await admin
        .from('seasons')
        .update(patch)
        .eq('id', season_id)
        .select('*')
        .single();

      if (error) throw error;
      return jsonResponse({ ok: true, season: updated });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    console.error('season-admin error:', (err as Error).message);
    return jsonResponse({ error: (err as Error).message }, 400);
  }
});
