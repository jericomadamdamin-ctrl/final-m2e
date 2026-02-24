import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  Trophy, Plus, Play, Square, Gift, Clock, Users, Diamond,
  Loader2, ChevronDown, ChevronUp, Crown, Medal, Cpu,
} from 'lucide-react';
import {
  seasonAdminList,
  seasonAdminCreate,
  seasonAdminActivate,
  seasonAdminEnd,
  seasonAdminDistribute,
  seasonAdminLeaderboard,
  seasonPayoutExecute,
} from '@/lib/backend';
import type {
  Season,
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
  const [createMachinePool, setCreateMachinePool] = useState(0);

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
        machine_pool_total: createMachinePool > 0 ? createMachinePool : 0,
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

  const handlePayout = async (seasonId: string) => {
    setActionLoading(seasonId + '-payout');
    try {
      const result = await seasonPayoutExecute(accessKey, seasonId);
      toast({
        title: 'Payouts executed',
        description: `${result.paid} paid, ${result.failed} failed.`,
      });
      await loadSeasons();
      if (expandedId === seasonId) await loadLeaderboard(seasonId);
    } catch (err) {
      toast({ title: 'Payout failed', description: getErrorMessage(err), variant: 'destructive' });
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
              {(activeSeason.machine_pool_total ?? 0) > 0 && (
                <div className="flex items-center gap-1 text-orange-400">
                  <Cpu className="w-3 h-3" />
                  {activeSeason.machine_pool_remaining ?? 0}/{activeSeason.machine_pool_total} mega machines
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="text-[10px] bg-green-500/10 text-green-300 border border-green-500/20 rounded px-2 py-0.5 font-bold">
                Revenue: {Number(activeSeason.revenue_wld ?? 0).toFixed(2)} WLD
              </span>
              <span className="text-[10px] bg-yellow-500/10 text-yellow-300 border border-yellow-500/20 rounded px-2 py-0.5">
                1st: 50% | 2nd: 30% | 3rd: 15% | 4-10: 5% | 11-20: 1K Oil
              </span>
            </div>
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

            <div className="space-y-2">
              <Label className="text-xs">Mega Machine Pool (0 = unlimited)</Label>
              <Input
                type="number"
                min={0}
                value={createMachinePool}
                onChange={(e) => setCreateMachinePool(Number(e.target.value) || 0)}
                className="bg-black/40 text-sm h-9 w-40"
                placeholder="0 = unlimited"
              />
              <p className="text-[10px] text-muted-foreground">Total mega machines available for purchase this season. Set to 0 for no limit.</p>
            </div>

            {/* Auto Reward Info */}
            <div className="rounded-lg bg-yellow-500/5 border border-yellow-500/10 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Gift className="w-3.5 h-3.5 text-yellow-400" />
                <span className="text-xs font-bold text-yellow-300">Automatic Rewards</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Rewards are calculated automatically from mega machine purchase revenue:
                1st 50% | 2nd 30% | 3rd 15% | 4-10th 5% (split) | 11-20th 1,000 Oil each.
              </p>
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
                    {(season.machine_pool_total ?? 0) > 0 && (
                      <span className="flex items-center gap-1 text-orange-400">
                        <Cpu className="w-3 h-3" />
                        {season.machine_pool_remaining ?? 0}/{season.machine_pool_total}
                      </span>
                    )}
                    {(season.revenue_wld ?? 0) > 0 && (
                      <span className="flex items-center gap-1 text-green-400">
                        <Gift className="w-3 h-3" />
                        {Number(season.revenue_wld).toFixed(2)} WLD
                      </span>
                    )}
                    {season.reward_count ? (
                      <span className="flex items-center gap-1">
                        <Crown className="w-3 h-3" />
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
                  {season.status === 'rewarded' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handlePayout(season.id)}
                      disabled={actionLoading === season.id + '-payout'}
                      className="h-7 text-[10px] border-green-500/30 text-green-400 hover:bg-green-500/10"
                    >
                      {actionLoading === season.id + '-payout' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Diamond className="w-3 h-3 mr-1" />}
                      Pay Rewards
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
                  {/* Revenue & Reward Breakdown */}
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2 font-bold">Revenue & Rewards</div>
                    <div className="bg-black/20 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Total Revenue</span>
                        <span className="text-xs text-green-300 font-bold">{Number(season.revenue_wld ?? 0).toFixed(2)} WLD</span>
                      </div>
                      {(() => {
                        const rev = Number(season.revenue_wld ?? 0);
                        return (
                          <div className="flex flex-wrap gap-2 pt-1">
                            <span className="text-[10px] bg-yellow-500/10 text-yellow-300 border border-yellow-500/20 rounded px-2 py-0.5">1st: {(rev * 0.50).toFixed(2)} WLD</span>
                            <span className="text-[10px] bg-slate-500/10 text-slate-300 border border-slate-500/20 rounded px-2 py-0.5">2nd: {(rev * 0.30).toFixed(2)} WLD</span>
                            <span className="text-[10px] bg-orange-500/10 text-orange-300 border border-orange-500/20 rounded px-2 py-0.5">3rd: {(rev * 0.15).toFixed(2)} WLD</span>
                            <span className="text-[10px] bg-purple-500/10 text-purple-300 border border-purple-500/20 rounded px-2 py-0.5">4-10th: {(rev * 0.05).toFixed(2)} WLD (split)</span>
                            <span className="text-[10px] bg-green-500/10 text-green-300 border border-green-500/20 rounded px-2 py-0.5">11-20th: 1K Oil each</span>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

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
                                <div className="flex items-center gap-1">
                                  {reward.reward_wld > 0 && (
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${reward.status === 'paid'
                                      ? 'bg-green-500/20 text-green-300'
                                      : reward.status === 'failed'
                                      ? 'bg-red-500/20 text-red-300'
                                      : 'bg-yellow-500/20 text-yellow-300'
                                      }`}>
                                      {Number(reward.reward_wld).toFixed(2)} WLD
                                      {reward.status === 'paid' ? ' (paid)' : reward.status === 'failed' ? ' (failed)' : ''}
                                    </span>
                                  )}
                                  {(reward.reward_oil ?? 0) > 0 && (
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${reward.status === 'paid'
                                      ? 'bg-green-500/20 text-green-300'
                                      : 'bg-emerald-500/20 text-emerald-300'
                                      }`}>
                                      {reward.reward_oil} Oil
                                      {reward.status === 'paid' ? ' (paid)' : ''}
                                    </span>
                                  )}
                                </div>
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
