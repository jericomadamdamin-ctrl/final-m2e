import { useState } from 'react';
import { GameConfig, MineralType, MINERAL_LABELS } from '@/types/game';
import { Button } from '@/components/ui/button';
import { ArrowRight, Sparkles } from 'lucide-react';
import { MineralIcon } from './MineralIcon';
import { formatCompactNumber } from '@/lib/format';

interface MarketTabProps {
  config: GameConfig;
  minerals: Record<MineralType, number>;
  oilBalance: number;
  onExchange: (type: MineralType, amount: number) => void;
}

export const MarketTab = ({ config, minerals, oilBalance, onExchange }: MarketTabProps) => {
  const [selectedAmounts, setSelectedAmounts] = useState<Record<MineralType, number>>({
    bronze: 0,
    silver: 0,
    gold: 0,
    iron: 0,
  });

  const handleAmountChange = (type: MineralType, delta: number) => {
    setSelectedAmounts(prev => ({
      ...prev,
      [type]: Math.max(0, Math.min(minerals[type], prev[type] + delta)),
    }));
  };

  const handleExchange = (type: MineralType) => {
    const amount = Math.floor(selectedAmounts[type]);
    if (amount > 0) {
      const finalAmount = Math.min(amount, 1000000);
      onExchange(type, finalAmount);
      setSelectedAmounts(prev => ({ ...prev, [type]: 0 }));
    }
  };

  const handleExchangeAll = (type: MineralType) => {
    if (minerals[type] > 0) {
      onExchange(type, minerals[type]);
      setSelectedAmounts(prev => ({ ...prev, [type]: 0 }));
    }
  };

  return (
    <div className="space-y-4 pb-4">
      {/* Header with balances */}
      <div className="flex items-center justify-between px-1">
        <h2 className="font-pixel text-xs text-primary text-glow">Market</h2>
        <div className="flex gap-2">
          <div className="flex items-center gap-1 bg-secondary/50 px-2 py-1 rounded-full text-xs">
            <span>🛢️</span>
            <span className="font-bold tabular-nums max-w-[80px] truncate">{formatCompactNumber(Math.floor(oilBalance))}</span>
          </div>
        </div>
      </div>

      <p className="text-muted-foreground text-xs px-1">
        Exchange your minerals for OIL credits.
      </p>

      {/* Exchange rates info */}
      <div className="card-game rounded-lg p-3">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-accent" />
          <span className="font-bold text-sm">Exchange Rates</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {(Object.keys(config.mining.action_rewards.minerals) as MineralType[]).map(mineral => (
            <div key={mineral} className="flex items-center justify-between bg-secondary/30 rounded px-2 py-1">
              <span className="flex items-center gap-1">
                <MineralIcon icon={mineral} size="sm" /> 1 {MINERAL_LABELS[mineral]}
              </span>
              <span className="text-game-oil font-bold">= {config.mining.action_rewards.minerals[mineral].oil_value} 🛢️</span>
            </div>
          ))}
        </div>
      </div>

      {/* Mineral exchange cards */}
      <div className="space-y-3">
        {(Object.keys(config.mining.action_rewards.minerals) as MineralType[]).map(mineral => {
          const amount = minerals[mineral];
          const selected = selectedAmounts[mineral];
          const reward = (selected * config.mining.action_rewards.minerals[mineral].oil_value).toFixed(1);

          return (
            <div
              key={mineral}
              className={`card-game rounded-xl p-4 ${amount > 0 ? '' : 'opacity-50'}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <MineralIcon icon={mineral} size="lg" className="text-3xl" />
                  <div>
                    <h4 className="font-bold">{MINERAL_LABELS[mineral]}</h4>
                    <p className="text-xs text-muted-foreground">
                      Drop rate: {Math.round(config.mining.action_rewards.minerals[mineral].drop_rate * 100)}%
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">You have</div>
                  <div className="font-bold text-lg">
                    {Math.floor(amount)}
                  </div>
                </div>
              </div>

              {/* Amount selector */}
              <div className="flex items-center gap-2 mb-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-10 h-8"
                  onClick={() => handleAmountChange(mineral, -10)}
                  disabled={amount === 0}
                >
                  -10
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-8 h-8"
                  onClick={() => handleAmountChange(mineral, -1)}
                  disabled={amount === 0}
                >
                  -
                </Button>
                <div className="flex-1 text-center font-bold bg-secondary/30 rounded py-1">
                  {selected}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-8 h-8"
                  onClick={() => handleAmountChange(mineral, 1)}
                  disabled={selected >= amount}
                >
                  +
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-10 h-8"
                  onClick={() => handleAmountChange(mineral, 10)}
                  disabled={selected >= amount}
                >
                  +10
                </Button>
              </div>

              {/* Exchange preview and buttons */}
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center justify-center gap-2 text-sm">
                  <span className="flex items-center gap-1"><MineralIcon icon={mineral} size="sm" /> {selected}</span>
                  <ArrowRight className="w-4 h-4 text-primary" />
                  <span className="text-game-oil font-bold">🛢️ {reward}</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleExchangeAll(mineral)}
                  disabled={amount === 0}
                  className="text-xs"
                >
                  Max
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleExchange(mineral)}
                  disabled={selected === 0}
                  className="glow-green"
                >
                  Exchange
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
