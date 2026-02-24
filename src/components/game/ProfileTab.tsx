import { Machine, PlayerState, MINERAL_LABELS, MineralType, GameConfig } from '@/types/game';
import { Settings, Gem, User, Shield, Copy, Users, Loader2, Timer, Info } from 'lucide-react';
import { MineralIcon } from './MineralIcon';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { updateConfig, gameAction } from '@/lib/backend';
import { useToast } from '@/hooks/use-toast';
import { formatCompactNumber } from '@/lib/format';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ProfileTabProps {
  player: PlayerState;
  machines: Machine[];
  config: GameConfig | null;
  isAdmin: boolean;
  playerName: string;
  referralCode?: string;
  referralCount?: number;
}

const ClaimButton = ({ lastClaim, onClaim, loading }: { lastClaim?: string, onClaim: () => void, loading: boolean }) => {
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [canClaim, setCanClaim] = useState(false);

  useEffect(() => {
    const updateTimer = () => {
      if (!lastClaim) {
        setCanClaim(true);
        setTimeLeft('');
        return;
      }

      const lastClaimTime = new Date(lastClaim).getTime();
      const now = Date.now();
      const nextClaimTime = lastClaimTime + (24 * 60 * 60 * 1000); // 24 hours
      const diff = nextClaimTime - now;

      if (diff <= 0) {
        setCanClaim(true);
        setTimeLeft('');
      } else {
        setCanClaim(false);
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [lastClaim]);

  if (loading) {
    return (
      <Button disabled size="sm" className="h-8 text-xs bg-accent/20 border border-accent/50">
        <Loader2 className="w-3 h-3 animate-spin" />
      </Button>
    );
  }

  if (!canClaim) {
    return (
      <Button disabled size="sm" className="h-8 text-[10px] bg-secondary/50 text-muted-foreground border border-white/5 font-mono">
        {timeLeft || 'Wait...'}
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      onClick={onClaim}
      className="h-8 text-xs glow-green animate-pulse font-bold"
    >
      Claim
    </Button>
  );
};

export const ProfileTab = ({ player, machines, config, isAdmin, playerName, referralCode, referralCount = 0 }: ProfileTabProps) => {
  const { toast } = useToast();
  const [claimingDaily, setClaimingDaily] = useState(false);

  if (!player || !config) {
    return <div className="p-8 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></div>;
  }

  const totalMinerals = Object.values(player.minerals).reduce((a, b) => a + b, 0);

  const handleDailyClaim = async () => {
    setClaimingDaily(true);
    try {
      const { state } = await gameAction('claim_daily_reward');
      toast({
        title: "Daily Reward Claimed!",
        description: `You received ${config?.global_game_settings?.daily_oil_reward ?? 5} Oil.`,
        className: "glow-green border-primary"
      });
      // Re-trigger refresh? state is returned so implicit update via react-query mutation if we used it, 
      // but here we might need to rely on parent refresh or the fact that `oilBalance` updates from prop if parent fetches.
      // For now, the toast confirms it, and next poll updates balance.
    } catch (err: any) {
      toast({
        title: "Claim Failed",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      setClaimingDaily(false);
    }
  };

  return (
    <div className="space-y-4 pb-4">
      {/* Profile Header */}
      <div className="card-game rounded-xl p-4">
        {/* ... existing header ... */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center glow-green">
            <User className="w-8 h-8 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="font-bold text-lg">{playerName}</h2>
            <p className="text-muted-foreground text-xs">
              {machines.length} machine{machines.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Daily Reward Section */}
        <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-accent/20 rounded-full">
              <Timer className="w-4 h-4 text-accent" />
            </div>
            <div>
              <div className="text-xs font-bold">Daily Supply</div>
              <div className="text-[10px] text-muted-foreground pb-0.5">
                +{config?.global_game_settings?.daily_oil_reward ?? 5} Free Oil
              </div>
            </div>
          </div>

          <ClaimButton
            lastClaim={player.lastDailyClaim}
            onClaim={handleDailyClaim}
            loading={claimingDaily}
          />
        </div>
      </div>

      {/* Token Balances */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card-game rounded-xl p-4 text-center">
          <div className="text-3xl mb-2">🛢️</div>
          <div className="font-bold text-xl text-game-oil tabular-nums max-w-[200px] truncate">{formatCompactNumber(Math.floor(player.oilBalance))}</div>
          <div className="text-xs text-muted-foreground">OIL Credits</div>
        </div>
        <div className="card-game rounded-xl p-4 text-center glow-diamond">
          {/* ... diamonds ... */}
          <div className="text-3xl mb-2">💎</div>
          <div className="font-bold text-xl text-game-diamond">{player.diamondBalance.toFixed(2)}</div>
          <div className="text-xs text-muted-foreground">Diamonds</div>
        </div>
      </div>

      {/* Converted Oil Stats */}
      {player.totalConvertedOil !== undefined && (
        <div className="card-game rounded-xl p-3 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Lifetime Converted Oil:</span>
          <span className="text-sm font-bold text-game-oil tabular-nums">
            {formatCompactNumber(player.totalConvertedOil)} 🛢️
          </span>
        </div>
      )}

      {/* Referral Program */}
      {/* ... existing referral code ... */}
      {referralCode && (
        <div className="card-game rounded-xl p-4">
          {/* ... existing referral content ... */}
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-primary" />
            <span className="font-bold text-sm">Referral Program</span>
            <span className="ml-auto text-xs text-muted-foreground">
              💎 1 Diamond per referral
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-secondary/50 rounded-lg px-3 py-2 font-mono text-lg tracking-widest text-center text-primary">
              {referralCode}
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="h-9 transition-transform active:scale-95"
              onClick={() => {
                navigator.clipboard.writeText(referralCode);
                toast({ title: 'Copied!', description: 'Referral code copied to clipboard.' });
              }}
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <div className="mt-3 text-center">
            <span className="text-xs text-muted-foreground">Successful referrals: </span>
            <span className="font-bold text-primary">{referralCount}</span>
          </div>
        </div>
      )}

      {/* Minerals */}
      <div className="card-game rounded-xl p-4">
        {/* ... existing minerals ... */}
        <div className="flex items-center gap-2 mb-3">
          <Gem className="w-4 h-4 text-primary" />
          <span className="font-bold text-sm">Mineral Collection</span>
          <span className="ml-auto text-xs text-muted-foreground">
            Total: {totalMinerals.toFixed(0)}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {(Object.keys(player.minerals) as MineralType[]).map(mineral => (
            <div key={mineral} className="text-center">
              <MineralIcon icon={mineral} size="md" className="mb-1 mx-auto" />
              <div className="text-xs font-bold">
                {Math.floor(player.minerals[mineral])}
              </div>
              <div className="text-[10px] text-muted-foreground">{MINERAL_LABELS[mineral]}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Machine ROI Info */}
      {config && (
        <div className="card-game rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <Info className="w-4 h-4 text-primary" />
            <span className="font-bold text-sm">Machine Earnings Info</span>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-white/10 hover:bg-transparent">
                  <TableHead className="text-[10px] h-8 text-muted-foreground">Machine</TableHead>
                  <TableHead className="text-[10px] h-8 text-right text-muted-foreground">Lvl 1 💎 Drop</TableHead>
                  <TableHead className="text-[10px] h-8 text-right text-muted-foreground">Max Lvl 💎</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(Object.entries(config.machines) as [string, GameConfig['machines'][string]][]).map(([type, stats]) => {
                  // Calculate effective diamond drop rate per hour
                  // Drop Rate Per Action * Actions Per Hour
                  // Note: Diamonds are per action.
                  // Lvl 1 Speed = stats.speed_actions_per_hour
                  // Max Lvl Speed = stats.speed * (1 + (max_level-1) * multiplier)
                  const dropPerAction = config.mining.action_rewards.diamond.drop_rate_per_action;
                  const lvl1Speed = stats.speed_actions_per_hour;
                  const maxLevel = stats.max_level;
                  const speedMult = config.progression.level_speed_multiplier;
                  const maxSpeed = lvl1Speed * (1 + (maxLevel - 1) * speedMult);

                  const hourlyLvl1 = (lvl1Speed * dropPerAction).toFixed(3);
                  const hourlyMax = (maxSpeed * dropPerAction).toFixed(3);

                  return (
                    <TableRow key={type} className="border-b border-white/5 hover:bg-white/5">
                      <TableCell className="text-xs font-bold capitalize py-2">{stats.name || type}</TableCell>
                      <TableCell className="text-xs text-right py-2">{hourlyLvl1}/hr</TableCell>
                      <TableCell className="text-xs text-right py-2 text-game-diamond">{hourlyMax}/hr</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 italic text-center">
            *Estimates based on active mining. Actual earnings vary by luck and uptime.
          </p>
        </div>
      )}

      {/* Mining Setup */}
      {/* ... existing mining setup ... */}
      <div className="card-game rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Settings className="w-4 h-4 text-primary" />
          <span className="font-bold text-sm">Active Fleet</span>
        </div>
        {machines.length > 0 ? (
          <div className="space-y-2">
            {machines.map(machine => (
              <div
                key={machine.id}
                className={`flex items-center gap-3 bg-secondary/30 rounded-lg p-2 ${machine.isActive ? 'border border-primary/30' : ''
                  }`}
              >
                <span className="text-2xl">⛏️</span>
                <div className="flex-1">
                  <div className="text-sm font-bold capitalize">{config?.machines[machine.type]?.name || machine.type}</div>
                  <div className="text-xs text-muted-foreground">
                    Level {machine.level}
                  </div>
                </div>
                <div className={`px-2 py-0.5 rounded text-xs font-bold ${machine.isActive
                  ? 'bg-primary/20 text-primary'
                  : 'bg-muted text-muted-foreground'
                  }`}>
                  {machine.isActive ? 'ACTIVE' : 'IDLE'}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs text-center py-4">
            No machines yet. Visit the Shop!
          </p>
        )}
      </div>

    </div>
  );
};
