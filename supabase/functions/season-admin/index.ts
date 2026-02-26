import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, requireUserId, requireAdminOrKey } from '../_shared/supabase.ts';

interface SeasonCreateBody {
  name: string;
  description?: string;
  duration_hours: number;
  machine_pool_total?: number;
}

const AUTO_REWARD_TIERS = [
  { rank_from: 1, rank_to: 1, percentage: 40, reward_type: 'wld', label: '1st Place' },
  { rank_from: 2, rank_to: 2, percentage: 20, reward_type: 'wld', label: '2nd Place' },
  { rank_from: 3, rank_to: 3, percentage: 10, reward_type: 'wld', label: '3rd Place' },
  { rank_from: 4, rank_to: 10, percentage: 0, reward_type: 'diamonds', reward_diamonds: 10, label: 'Top 4-10' },
  { rank_from: 11, rank_to: 20, percentage: 0, reward_type: 'oil', reward_oil: 1000, label: 'Top 11-20' },
];

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
            .eq('season_id', s.id)
            .eq('has_mega_machine', true);

          const { data: diamondAgg } = await admin
            .from('seasonal_leaderboard')
            .select('diamonds_collected')
            .eq('season_id', s.id)
            .eq('has_mega_machine', true);

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
      const { name, description, duration_hours, machine_pool_total } = body as SeasonCreateBody;
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
          reward_tiers: AUTO_REWARD_TIERS,
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

    // ── DISTRIBUTE ── (auto-calculated from revenue)
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

      const revenueWld = Number(season.revenue_wld ?? 0);

      const { data: topPlayers, error: lbErr } = await admin
        .from('seasonal_leaderboard')
        .select('user_id, diamonds_collected')
        .eq('season_id', season_id)
        .eq('has_mega_machine', true)
        .order('diamonds_collected', { ascending: false })
        .limit(20);

      if (lbErr) throw lbErr;

      const players = topPlayers ?? [];

      const WLD_TIERS = [
        { rank: 1, pct: 40 },
        { rank: 2, pct: 20 },
        { rank: 3, pct: 10 },
      ];
      const DIAMOND_REWARD_4_10 = 10;
      const OIL_REWARD = 1000;

      const rewards: Array<{
        season_id: string;
        user_id: string;
        rank: number;
        diamonds_collected: number;
        reward_wld: number;
        reward_oil: number;
        reward_diamonds: number;
        status: string;
      }> = [];

      players.forEach((player: any, idx: number) => {
        const rank = idx + 1;
        let rewardWld = 0;
        let rewardOil = 0;
        let rewardDiamonds = 0;

        if (rank <= 3) {
          const tier = WLD_TIERS.find((t) => t.rank === rank);
          rewardWld = tier ? revenueWld * tier.pct / 100 : 0;
        } else if (rank <= 10) {
          rewardDiamonds = DIAMOND_REWARD_4_10;
        } else if (rank <= 20) {
          rewardOil = OIL_REWARD;
        }

        rewardWld = Math.round(rewardWld * 1e6) / 1e6;

        if (rewardWld > 0 || rewardOil > 0 || rewardDiamonds > 0) {
          rewards.push({
            season_id,
            user_id: player.user_id,
            rank,
            diamonds_collected: Number(player.diamonds_collected),
            reward_wld: rewardWld,
            reward_oil: rewardOil,
            reward_diamonds: rewardDiamonds,
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

      return jsonResponse({ ok: true, rewards_created: rewards.length, revenue_wld: revenueWld, rewards });
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
        .eq('has_mega_machine', true)
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
