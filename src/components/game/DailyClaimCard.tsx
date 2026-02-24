import { Button } from '@/components/ui/button';
import { Calendar, Clock, Gift } from 'lucide-react';

interface DailyClaimCardProps {
  lastClaim: string | null;
  streak: number;
  onClaim: () => void;
}

const DAILY_OIL_REWARD = 30;
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

export const DailyClaimCard = ({ lastClaim, streak, onClaim }: DailyClaimCardProps) => {
  const now = Date.now();
  const lastClaimTime = lastClaim ? new Date(lastClaim).getTime() : 0;
  const timeSinceClaim = now - lastClaimTime;
  const canClaim = timeSinceClaim >= COOLDOWN_MS;
  const timeRemaining = COOLDOWN_MS - timeSinceClaim;

  const formatTimeRemaining = (ms: number) => {
    if (ms <= 0) return 'Ready!';
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    return `${hours}h ${minutes}m`;
  };

  return (
    <div className={`card-game rounded-xl p-4 ${canClaim ? 'glow-green' : ''}`}>
      <div className="flex items-center gap-3">
        <div className={`text-3xl ${canClaim ? 'animate-float' : ''}`}>
          🎁
        </div>
        
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm">Daily Reward</h3>
            {streak > 0 && (
              <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {streak} day streak
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground">Reward:</span>
            <span className="text-xs bg-secondary/50 px-2 py-0.5 rounded flex items-center gap-1">
              <span>🛢️</span>
              <span className="text-game-oil font-bold">+{DAILY_OIL_REWARD}</span>
            </span>
          </div>
        </div>

        {canClaim ? (
          <Button size="sm" className="glow-green" onClick={onClaim}>
            <Gift className="w-4 h-4 mr-1" />
            Claim
          </Button>
        ) : (
          <div className="flex items-center gap-1 text-xs text-muted-foreground bg-secondary/30 px-3 py-2 rounded-lg">
            <Clock className="w-3 h-3" />
            {formatTimeRemaining(timeRemaining)}
          </div>
        )}
      </div>
    </div>
  );
};

export { DAILY_OIL_REWARD, COOLDOWN_MS };
