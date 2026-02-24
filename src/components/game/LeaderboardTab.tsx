import { useEffect, useState } from 'react';
import { Trophy, Medal, Crown, Diamond, Clock, RefreshCw, Gift } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface LeaderboardEntry {
  rank: number;
  user_id: string;
  player_name: string;
  diamonds_collected: number;
  last_updated: string;
}

interface RewardTier {
  rank_from: number;
  rank_to: number;
  reward_wld: number;
  label: string;
}

interface SeasonData {
  id: string;
  name: string;
  description?: string | null;
  start_time: string;
  end_time: string;
  status: string;
  is_active: boolean;
  reward_tiers: RewardTier[];
}

interface LeaderboardTabProps {
  currentUserId: string;
}

function getTimeRemaining(endTime: string) {
  const total = new Date(endTime).getTime() - Date.now();
  if (total <= 0) return { days: 0, hours: 0, minutes: 0, expired: true };
  const days = Math.floor(total / (1000 * 60 * 60 * 24));
  const hours = Math.floor((total / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((total / (1000 * 60)) % 60);
  return { days, hours, minutes, expired: false };
}

function formatDiamonds(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

function getRewardForRank(tiers: RewardTier[], rank: number): RewardTier | undefined {
  return tiers.find((t) => rank >= t.rank_from && rank <= t.rank_to);
}

const RANK_STYLES = [
  {
    bg: 'bg-gradient-to-r from-yellow-500/20 to-amber-400/10',
    border: 'border-yellow-400/50',
    badge: 'text-yellow-300',
    icon: <Crown className="w-5 h-5 text-yellow-300" />,
    glow: 'shadow-[0_0_20px_rgba(250,204,21,0.2)]',
  },
  {
    bg: 'bg-gradient-to-r from-slate-400/20 to-zinc-300/10',
    border: 'border-slate-300/50',
    badge: 'text-slate-300',
    icon: <Medal className="w-5 h-5 text-slate-300" />,
    glow: 'shadow-[0_0_12px_rgba(148,163,184,0.15)]',
  },
  {
    bg: 'bg-gradient-to-r from-orange-600/20 to-amber-700/10',
    border: 'border-orange-500/50',
    badge: 'text-orange-400',
    icon: <Medal className="w-5 h-5 text-orange-400" />,
    glow: 'shadow-[0_0_12px_rgba(234,88,12,0.15)]',
  },
];

export const LeaderboardTab = ({ currentUserId }: LeaderboardTabProps) => {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [season, setSeason] = useState<SeasonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, expired: false });
  const [currentUserRank, setCurrentUserRank] = useState<LeaderboardEntry | null>(null);

  // For showing the most recently ended season when no active one exists
  const [pastSeason, setPastSeason] = useState<SeasonData | null>(null);

  const fetchLeaderboard = async () => {
    setLoading(true);
    setError(null);
    setPastSeason(null);
    try {
      // Try active season first (use status column)
      let { data: seasonData, error: seasonErr } = await supabase
        .from('seasons')
        .select('*')
        .eq('status', 'active')
        .gt('end_time', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Fallback to is_active for backward compat
      if (!seasonData) {
        const fallback = await supabase
          .from('seasons')
          .select('*')
          .eq('is_active', true)
          .gt('end_time', new Date().toISOString())
          .limit(1)
          .maybeSingle();
        if (fallback.data) seasonData = fallback.data;
      }

      if (!seasonData) {
        // Show most recently ended/rewarded season instead
        const { data: recentSeason } = await supabase
          .from('seasons')
          .select('*')
          .in('status', ['ended', 'rewarded'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (recentSeason) {
          setPastSeason(recentSeason as SeasonData);
          await loadLeaderboardEntries(recentSeason.id);
        } else {
          setError('No active season found.');
        }
        setLoading(false);
        return;
      }

      setSeason(seasonData as SeasonData);
      await loadLeaderboardEntries(seasonData.id);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load leaderboard.');
    } finally {
      setLoading(false);
    }
  };

  const loadLeaderboardEntries = async (seasonId: string) => {
    const { data: lbData, error: lbErr } = await supabase
      .from('seasonal_leaderboard')
      .select(`
        user_id,
        diamonds_collected,
        last_updated,
        profiles!inner(player_name)
      `)
      .eq('season_id', seasonId)
      .order('diamonds_collected', { ascending: false })
      .limit(50);

    if (lbErr) throw lbErr;

    const ranked: LeaderboardEntry[] = (lbData || []).map((row: any, i: number) => ({
      rank: i + 1,
      user_id: row.user_id,
      player_name: row.profiles?.player_name ?? 'Unknown Miner',
      diamonds_collected: Number(row.diamonds_collected),
      last_updated: row.last_updated,
    }));

    setEntries(ranked);
    setCurrentUserRank(ranked.find((e) => e.user_id === currentUserId) ?? null);
  };

  useEffect(() => {
    fetchLeaderboard();
  }, [currentUserId]);

  useEffect(() => {
    if (!season) return;
    const update = () => setTimeLeft(getTimeRemaining(season.end_time));
    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, [season]);

  const displaySeason = season || pastSeason;
  const rewardTiers: RewardTier[] = (displaySeason?.reward_tiers ?? []) as RewardTier[];
  const isPast = !season && !!pastSeason;

  return (
    <div className="flex flex-col gap-4 pb-8 animate-fade-in">
      {/* Header */}
      <div className="relative rounded-2xl overflow-hidden border border-primary/20 bg-gradient-to-br from-card/80 to-card/40 backdrop-blur-sm p-5">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-game-gold/5 pointer-events-none" />
        <div className="flex items-center justify-between relative z-10">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 bg-game-gold/30 blur-lg rounded-full" />
              <Trophy className="w-8 h-8 text-game-gold relative z-10" />
            </div>
            <div>
              <h2 className="font-pixel text-lg text-primary text-glow leading-tight">
                {displaySeason?.name ?? 'Season Rankings'}
              </h2>
              <p className="text-xs text-muted-foreground font-pixel">
                {isPast ? 'Season Ended' : 'Diamond Leaderboard'}
              </p>
            </div>
          </div>
          <button
            onClick={fetchLeaderboard}
            disabled={loading}
            className="p-2 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-primary/10 transition-all"
          >
            <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Season timer */}
        {season && !timeLeft.expired && (
          <div className="flex items-center gap-2 mt-4 relative z-10">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground font-pixel">Season ends in:</span>
            <div className="flex gap-1.5">
              {[
                { val: timeLeft.days, label: 'D' },
                { val: timeLeft.hours, label: 'H' },
                { val: timeLeft.minutes, label: 'M' },
              ].map(({ val, label }) => (
                <div
                  key={label}
                  className="bg-primary/10 border border-primary/20 rounded px-2 py-0.5 flex items-center gap-0.5"
                >
                  <span className="font-pixel text-xs text-primary">{val}</span>
                  <span className="font-pixel text-[10px] text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {isPast && (
          <div className="mt-3 relative z-10">
            <span className="text-[10px] bg-orange-500/20 text-orange-300 border border-orange-500/30 rounded px-2 py-0.5 font-pixel uppercase">
              Season Complete
            </span>
          </div>
        )}
      </div>

      {/* Reward Tiers */}
      {rewardTiers.length > 0 && (
        <div className="rounded-xl border border-yellow-500/20 bg-gradient-to-r from-yellow-500/5 to-amber-500/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Gift className="w-4 h-4 text-yellow-400" />
            <span className="font-pixel text-xs text-yellow-300">Season Rewards</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {rewardTiers.map((tier, i) => (
              <div
                key={i}
                className="flex items-center gap-2 bg-black/30 rounded-lg px-3 py-2 border border-yellow-500/10"
              >
                <span className="font-pixel text-[10px] text-yellow-200">
                  #{tier.rank_from}{tier.rank_to !== tier.rank_from ? `-${tier.rank_to}` : ''}
                </span>
                {tier.label && (
                  <span className="text-[10px] text-muted-foreground">{tier.label}</span>
                )}
                <span className="font-pixel text-xs text-yellow-300 font-bold">{tier.reward_wld} WLD</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Current user rank pill */}
      {currentUserRank && currentUserRank.rank > 10 && (
        <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-pixel text-sm text-primary">#{currentUserRank.rank}</span>
            <span className="font-pixel text-xs text-foreground">{currentUserRank.player_name}</span>
            <span className="text-xs text-muted-foreground font-pixel">(You)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Diamond className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-pixel text-xs text-cyan-300">
              {formatDiamonds(currentUserRank.diamonds_collected)}
            </span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-center">
          <p className="font-pixel text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !error && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border/30 bg-card/40 p-4 animate-pulse h-16"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && entries.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <Diamond className="w-12 h-12 text-muted-foreground/40" />
          <p className="font-pixel text-sm text-muted-foreground text-center">
            No miners ranked yet.
            <br />Be the first to collect diamonds!
          </p>
        </div>
      )}

      {/* Leaderboard list */}
      {!loading && !error && entries.length > 0 && (
        <div className="flex flex-col gap-2">
          {entries.map((entry) => {
            const isCurrentUser = entry.user_id === currentUserId;
            const isTop3 = entry.rank <= 3;
            const style = isTop3 ? RANK_STYLES[entry.rank - 1] : null;
            const reward = getRewardForRank(rewardTiers, entry.rank);

            return (
              <div
                key={entry.user_id}
                className={`
                  relative rounded-xl border p-4 flex items-center gap-3 transition-all
                  ${isCurrentUser
                    ? 'border-primary/50 bg-primary/10 shadow-[0_0_15px_rgba(var(--primary),0.1)]'
                    : style
                    ? `${style.border} ${style.bg} ${style.glow}`
                    : 'border-border/30 bg-card/30 hover:border-border/60'}
                `}
              >
                {/* Rank */}
                <div className="w-8 flex justify-center shrink-0">
                  {style ? (
                    style.icon
                  ) : (
                    <span className="font-pixel text-xs text-muted-foreground">
                      #{entry.rank}
                    </span>
                  )}
                </div>

                {/* Player name */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-pixel text-sm truncate ${isCurrentUser ? 'text-primary' : isTop3 ? style!.badge : 'text-foreground'}`}>
                      {entry.player_name}
                    </span>
                    {isCurrentUser && (
                      <span className="shrink-0 font-pixel text-[9px] bg-primary/20 text-primary border border-primary/30 rounded px-1.5 py-0.5">
                        YOU
                      </span>
                    )}
                  </div>
                  {reward && (
                    <span className="text-[9px] text-yellow-400 font-pixel">
                      {reward.reward_wld} WLD reward
                    </span>
                  )}
                </div>

                {/* Diamonds */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <Diamond className={`w-4 h-4 ${isTop3 ? 'text-cyan-300' : 'text-cyan-500/70'}`} />
                  <span className={`font-pixel text-sm ${isTop3 ? 'text-cyan-200' : 'text-cyan-400'}`}>
                    {formatDiamonds(entry.diamonds_collected)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
