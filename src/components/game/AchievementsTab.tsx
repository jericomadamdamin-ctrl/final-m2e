import { ACHIEVEMENTS, AchievementId } from '@/types/achievements';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Trophy, Gift, Check } from 'lucide-react';
import { MineralIcon } from './MineralIcon';

interface AchievementsTabProps {
  progress: Record<AchievementId, number>;
  claimed: AchievementId[];
  onClaim: (id: AchievementId) => void;
}

export const AchievementsTab = ({ progress, claimed, onClaim }: AchievementsTabProps) => {
  const getProgress = (id: AchievementId) => progress[id] || 0;
  
  const sortedAchievements = [...ACHIEVEMENTS].sort((a, b) => {
    const aComplete = getProgress(a.id) >= a.requirement;
    const bComplete = getProgress(b.id) >= b.requirement;
    const aClaimed = claimed.includes(a.id);
    const bClaimed = claimed.includes(b.id);
    
    // Claimable first, then in-progress, then claimed
    if (aComplete && !aClaimed && (!bComplete || bClaimed)) return -1;
    if (bComplete && !bClaimed && (!aComplete || aClaimed)) return 1;
    if (aClaimed && !bClaimed) return 1;
    if (bClaimed && !aClaimed) return -1;
    return 0;
  });

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-center gap-2 px-1">
        <Trophy className="w-5 h-5 text-primary" />
        <h2 className="font-pixel text-xs text-primary text-glow">Achievements</h2>
      </div>

      <p className="text-muted-foreground text-xs px-1">
        Complete tasks to earn oil and minerals!
      </p>

      <div className="grid gap-3">
        {sortedAchievements.map(achievement => {
          const currentProgress = getProgress(achievement.id);
          const isComplete = currentProgress >= achievement.requirement;
          const isClaimed = claimed.includes(achievement.id);
          const progressPercent = Math.min((currentProgress / achievement.requirement) * 100, 100);

          return (
            <div
              key={achievement.id}
              className={`card-game rounded-xl p-4 transition-all duration-300 ${
                isComplete && !isClaimed ? 'glow-green' : ''
              } ${isClaimed ? 'opacity-60' : ''}`}
            >
              <div className="flex gap-3">
                {/* Icon */}
                <div className="flex flex-col items-center justify-center">
                  <div className={`text-3xl ${isComplete ? 'animate-float' : 'grayscale opacity-60'}`}>
                    {achievement.icon}
                  </div>
                  {isClaimed && (
                    <Check className="w-4 h-4 text-primary mt-1" />
                  )}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-bold text-sm">{achievement.name}</h3>
                      <p className="text-muted-foreground text-xs">
                        {achievement.description}
                      </p>
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="mt-2">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Progress</span>
                      <span className={isComplete ? 'text-primary font-bold' : ''}>
                        {currentProgress}/{achievement.requirement}
                      </span>
                    </div>
                    <Progress value={progressPercent} className="h-1.5" />
                  </div>

                  {/* Rewards */}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-muted-foreground">Rewards:</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      {achievement.reward.oil && (
                        <span className="text-xs bg-secondary/50 px-2 py-0.5 rounded flex items-center gap-1">
                          <span>🛢️</span>
                          <span className="text-game-oil font-bold">+{achievement.reward.oil}</span>
                        </span>
                      )}
                      {achievement.reward.minerals && Object.entries(achievement.reward.minerals).map(([type, amount]) => (
                        <span key={type} className="text-xs bg-secondary/50 px-2 py-0.5 rounded flex items-center gap-1">
                          <MineralIcon icon={type} size="sm" />
                          <span className="font-bold">+{amount}</span>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Claim Button */}
                  {isComplete && !isClaimed && (
                    <Button
                      size="sm"
                      className="mt-3 w-full glow-green"
                      onClick={() => onClaim(achievement.id)}
                    >
                      <Gift className="w-4 h-4 mr-2" />
                      Claim Reward
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
