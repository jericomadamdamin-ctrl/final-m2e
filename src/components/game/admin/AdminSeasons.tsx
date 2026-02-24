import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  Trophy, Plus, Play, Square, Gift, Clock, Users, Diamond,
  Loader2, ChevronDown, ChevronUp, Trash2, Crown, Medal,
} from 'lucide-react';
import {
  seasonAdminList,
  seasonAdminCreate,
  seasonAdminActivate,
  seasonAdminEnd,
  seasonAdminDistribute,
  seasonAdminLeaderboard,
} from '@/lib/backend';
import type {
  Season,
  SeasonRewardTier,
  SeasonLeaderboardEntry,
  SeasonReward,
  SeasonStatus,
} from '@/types/admin';
import { getErrorMessage } from '@/lib/error';

interface AdminSeasonsProps {
  accessKey: string;
}

const STATUS_COLORS: Record<SeasonStatus, string> = {
  draft: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30',
  active: 'bg-green-500/20 text-green-300 border-green-500/30',
  ended: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  rewarded: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
};

function formatTimeRemaining(endTime: string): string {
  const ms = new Date(endTime).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h remaining`;
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m remaining`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

export const AdminSeasons = ({ accessKey }: AdminSeasonsProps) => {
  const { toast } = useToast();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createDays, setCreateDays] = useState(30);
  const [createTiers, setCreateTiers] = useState<SeasonRewardTier[]>([
    { rank_from: 1, rank_to: 1, reward_wld: 5, label: '1st Place' },
    { rank_from: 2, rank_to: 3, reward_wld: 2, label: 'Runner Up' },
    { rank_from: 4, rank_to: 10, reward_wld: 1, label: 'Top 10' },
  ]);

  // Expanded season detail
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [leaderboardData, setLeaderboardData] = useState<{
    entries: SeasonLeaderboardEntry[];
    rewards: SeasonReward[];
  } | null>(null);
  const [lbLoading, setLbLoading] = useState(false);

  const loadSeasons = useCallback(async () => {
    setLoading(true);
    try {
      const result = await seasonAdminList(accessKey);
      setSeasons(result.seasons);
    } catch (err) {
      toast({ title: 'Failed to load seasons', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [accessKey, toast]);

  useEffect(() => {
    loadSeasons();
  }, [loadSeasons]);

  const handleCreate = async () => {
    if (!createName.trim()) {
      toast({ title: 'Name required', variant: 'destructive' });
      return;
    }
    setActionLoading('create');
    try {
      await seasonAdminCreate(accessKey, {
        name: createName.trim(),
        description: createDesc.trim() || undefined,
        duration_hours: createDays * 24,
        reward_tiers: createTiers.filter((t) => t.reward_wld > 0),
      });
      toast({ title: 'Season created', description: `"${createName}" is ready to activate.` });
      setShowCreate(false);
      setCreateName('');
      setCreateDesc('');
      await loadSeasons();
    } catch (err) {
      toast({ title: 'Create failed', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleActivate = async (seasonId: string) => {
    setActionLoading(seasonId);
    try {
      await seasonAdminActivate(accessKey, seasonId);
      toast({ title: 'Season activated', description: 'The season is now live.' });
      await loadSeasons();
    } catch (err) {
      toast({ title: 'Activation failed', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleEnd = async (seasonId: string) => {
    setActionLoading(seasonId);
    try {
      await seasonAdminEnd(accessKey, seasonId);
      toast({ title: 'Season ended', description: 'Leaderboard is now frozen.' });
      await loadSeasons();
    } catch (err) {
      toast({ title: 'End failed', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDistribute = async (seasonId: string) => {
    setActionLoading(seasonId);
    try {
      const result = await seasonAdminDistribute(accessKey, seasonId);
      toast({ title: 'Rewards distributed', description: `${result.rewards_created} reward(s) created.` });
      await loadSeasons();
      if (expandedId === seasonId) await loadLeaderboard(seasonId);
    } catch (err) {
      toast({ title: 'Distribution failed', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setActionLoading(null);
    }
  };

  const loadLeaderboard = async (seasonId: string) => {
    setLbLoading(true);
    try {
      const result = await seasonAdminLeaderboard(accessKey, seasonId);
      setLeaderboardData({ entries: result.entries, rewards: result.rewards });
    } catch (err) {
      toast({ title: 'Failed to load leaderboard', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setLbLoading(false);
    }
  };

  const toggleExpand = (seasonId: string) => {
    if (expandedId === seasonId) {
      setExpandedId(null);
      setLeaderboardData(null);
    } else {
      setExpandedId(seasonId);
      loadLeaderboard(seasonId);
    }
  };

  const addTier = () => {
    const last = createTiers[createTiers.length - 1];
    const nextFrom = last ? last.rank_to + 1 : 1;
    setCreateTiers([...createTiers, { rank_from: nextFrom, rank_to: nextFrom + 4, reward_wld: 0.5, label: '' }]);
  };

  const removeTier = (idx: number) => {
    setCreateTiers(createTiers.filter((_, i) => i !== idx));
  };

  const updateTier = (idx: number, field: keyof SeasonRewardTier, value: string | number) => {
    setCreateTiers(createTiers.map((t, i) => (i === idx ? { ...t, [field]: value } : t)));
  };

  const activeSeason = seasons.find((s) => s.status === 'active');

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Active Season Banner */}
      {activeSeason && (
        <Card className="border-green-500/30 bg-green-500/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-3 opacity-10">
            <Trophy className="w-16 h-16" />
          </div>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Active Season
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-lg font-bold">{activeSeason.name}</div>
              {activeSeason.description && (
                <div className="text-xs text-muted-foreground mt-1">{activeSeason.description}</div>
              )}
            </div>
            <div className="flex gap-4 text-xs">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Clock className="w-3 h-3" />
                {formatTimeRemaining(activeSeason.end_time)}
              </div>
              <div className="flex items-center gap-1 text-muted-foreground">
                <Users className="w-3 h-3" />
                {activeSeason.total_players ?? 0} miners
              </div>
              <div className="flex items-center gap-1 text-cyan-400">
                <Diamond className="w-3 h-3" />
                {formatNumber(activeSeason.total_diamonds ?? 0)}
              </div>
            </div>
            {activeSeason.reward_tiers.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {activeSeason.reward_tiers.map((t, i) => (
                  <span key={i} className="text-[10px] bg-yellow-500/10 text-yellow-300 border border-yellow-500/20 rounded px-2 py-0.5">
                    #{t.rank_from}{t.rank_to !== t.rank_from ? `-${t.rank_to}` : ''}: {t.reward_wld} WLD
                  </span>
                ))}
              </div>
            )}
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleEnd(activeSeason.id)}
              disabled={actionLoading === activeSeason.id}
              className="mt-2"
            >
              {actionLoading === activeSeason.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Square className="w-3 h-3 mr-1" />}
              End Season
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Season Management</span>
        <Button size="sm" variant="outline" onClick={() => setShowCreate(!showCreate)} className="h-8 text-xs">
          <Plus className="w-3 h-3 mr-1" />
          New Season
        </Button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4 space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">Season Name</Label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Season 1: Diamond Rush"
                className="bg-black/40 text-sm h-9"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Description (optional)</Label>
              <Input
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                placeholder="Compete for the most diamonds!"
                className="bg-black/40 text-sm h-9"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Duration (days)</Label>
              <Input
                type="number"
                min={1}
                max={365}
                value={createDays}
                onChange={(e) => setCreateDays(Number(e.target.value) || 1)}
                className="bg-black/40 text-sm h-9 w-32"
              />
            </div>

            {/* Reward Tiers */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Reward Tiers</Label>
                <Button type="button" size="sm" variant="ghost" onClick={addTier} className="h-6 text-[10px] px-2">
                  <Plus className="w-3 h-3 mr-1" /> Add Tier
                </Button>
              </div>
              <div className="space-y-2">
                {createTiers.map((tier, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-black/20 rounded-lg p-2">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground w-4">#</span>
                      <Input
                        type="number"
                        min={1}
                        value={tier.rank_from}
                        onChange={(e) => updateTier(idx, 'rank_from', Number(e.target.value))}
                        className="bg-black/40 h-7 w-14 text-xs text-center p-1"
                      />
                      <span className="text-[10px] text-muted-foreground">-</span>
                      <Input
                        type="number"
                        min={tier.rank_from}
                        value={tier.rank_to}
                        onChange={(e) => updateTier(idx, 'rank_to', Number(e.target.value))}
                        className="bg-black/40 h-7 w-14 text-xs text-center p-1"
                      />
                    </div>
                    <Input
                      type="number"
                      min={0}
                      step={0.1}
                      value={tier.reward_wld}
                      onChange={(e) => updateTier(idx, 'reward_wld', Number(e.target.value))}
                      className="bg-black/40 h-7 w-20 text-xs p-1"
                      placeholder="WLD"
                    />
                    <Input
                      value={tier.label}
                      onChange={(e) => updateTier(idx, 'label', e.target.value)}
                      className="bg-black/40 h-7 flex-1 text-xs p-1"
                      placeholder="Label"
                    />
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeTier(idx)} className="h-7 w-7 p-0 text-destructive/60 hover:text-destructive">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleCreate} disabled={actionLoading === 'create'} className="text-xs">
                {actionLoading === 'create' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                Create Season
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)} className="text-xs">
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Season List */}
      {loading && seasons.length === 0 && (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      <div className="space-y-3">
        {seasons.map((season) => (
          <Card key={season.id} className="border-white/5 bg-white/[0.02] overflow-hidden">
            <CardContent className="p-0">
              {/* Season Header Row */}
              <button
                className="w-full p-4 flex items-center gap-3 text-left hover:bg-white/5 transition-colors"
                onClick={() => toggleExpand(season.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-sm truncate">{season.name}</span>
                    <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded border ${STATUS_COLORS[season.status]}`}>
                      {season.status}
                    </span>
                  </div>
                  <div className="flex gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {season.total_players ?? 0}
                    </span>
                    <span className="flex items-center gap-1">
                      <Diamond className="w-3 h-3" />
                      {formatNumber(season.total_diamonds ?? 0)}
                    </span>
                    {season.reward_count ? (
                      <span className="flex items-center gap-1">
                        <Gift className="w-3 h-3" />
                        {season.reward_count} rewards
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {season.status === 'draft' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleActivate(season.id)}
                      disabled={actionLoading === season.id}
                      className="h-7 text-[10px] border-green-500/30 text-green-400 hover:bg-green-500/10"
                    >
                      {actionLoading === season.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
                      Activate
                    </Button>
                  )}
                  {season.status === 'ended' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDistribute(season.id)}
                      disabled={actionLoading === season.id}
                      className="h-7 text-[10px] border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                    >
                      {actionLoading === season.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Gift className="w-3 h-3 mr-1" />}
                      Distribute
                    </Button>
                  )}
                </div>

                {expandedId === season.id ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
              </button>

              {/* Expanded Detail */}
              {expandedId === season.id && (
                <div className="border-t border-white/5 p-4 space-y-4">
                  {/* Reward Tiers */}
                  {season.reward_tiers.length > 0 && (
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2 font-bold">Reward Tiers</div>
                      <div className="flex flex-wrap gap-2">
                        {season.reward_tiers.map((t, i) => (
                          <div key={i} className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-1.5 text-xs">
                            <span className="text-yellow-300 font-bold">
                              #{t.rank_from}{t.rank_to !== t.rank_from ? `-${t.rank_to}` : ''}
                            </span>
                            <span className="text-muted-foreground mx-1">{t.label || ''}</span>
                            <span className="text-yellow-200 font-bold">{t.reward_wld} WLD</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Leaderboard */}
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2 font-bold">Leaderboard</div>
                    {lbLoading ? (
                      <div className="flex justify-center py-4">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : leaderboardData && leaderboardData.entries.length > 0 ? (
                      <div className="space-y-1">
                        {leaderboardData.entries.slice(0, 20).map((entry) => {
                          const reward = leaderboardData.rewards.find((r) => r.user_id === entry.user_id);
                          return (
                            <div
                              key={entry.user_id}
                              className="flex items-center gap-2 bg-black/20 rounded-lg px-3 py-2 text-xs"
                            >
                              <div className="w-6 shrink-0 text-center">
                                {entry.rank === 1 ? <Crown className="w-4 h-4 text-yellow-300 mx-auto" /> :
                                  entry.rank <= 3 ? <Medal className="w-4 h-4 text-slate-300 mx-auto" /> :
                                    <span className="text-muted-foreground">#{entry.rank}</span>}
                              </div>
                              <span className="flex-1 truncate">{entry.player_name}</span>
                              <span className="text-cyan-400 font-mono">{formatNumber(entry.diamonds_collected)}</span>
                              {reward && (
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${reward.status === 'paid'
                                  ? 'bg-green-500/20 text-green-300'
                                  : 'bg-yellow-500/20 text-yellow-300'
                                  }`}>
                                  {reward.reward_wld} WLD
                                  {reward.status === 'paid' ? ' (paid)' : ''}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground text-center py-4">No entries yet</div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {!loading && seasons.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <Trophy className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No seasons created yet.</p>
          <p className="text-xs mt-1">Create your first season to start competing!</p>
        </div>
      )}
    </div>
  );
};
