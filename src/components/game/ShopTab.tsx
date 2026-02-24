import { GameConfig, Machine, MachineType } from '@/types/game';
import { Button } from '@/components/ui/button';
import { ShoppingCart, Zap, Clock, Droplet, Plus, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useToast } from "@/components/ui/use-toast";
import miningMachineIcon from '@/assets/machines/mining-machine.png';
import heavyMachineIcon from '@/assets/machines/heavy-machine.png';
import lightMachineIcon from '@/assets/machines/light-machine.png';
import miniMachineIcon from '@/assets/machines/mini-machine.png';
import { formatCompactNumber } from '@/lib/format';

const getMachineIcon = (type: string, config?: GameConfig) => {
  if (config?.machines[type]?.image_url) {
    return config.machines[type].image_url;
  }
  switch (type) {
    case 'mini':
      return miniMachineIcon;
    case 'heavy':
      return heavyMachineIcon;
    case 'light':
      return lightMachineIcon;
    default:
      return miningMachineIcon;
  }
};

interface ShopTabProps {
  config: GameConfig;
  oilBalance: number;
  machines: Machine[];
  maxSlots: number;
  onBuy: (type: MachineType) => void;
  onBuySlots?: () => void;
}

export const ShopTab = ({ config, oilBalance, machines, maxSlots, onBuy, onBuySlots }: ShopTabProps) => {
  const getMachineCount = (type: MachineType) => {
    return machines.filter(m => m.type === type).length;
  };

  const atSlotLimit = machines.length >= maxSlots;
  const slotConfig = config.slots ?? { base_slots: 10, max_total_slots: 30, slot_pack_price_wld: 1, slot_pack_size: 5 };
  const canBuyMoreSlots = maxSlots < slotConfig.max_total_slots && onBuySlots;

  const [buyingType, setBuyingType] = useState<MachineType | null>(null);
  const { toast } = useToast();

  const handleBuy = async (type: MachineType) => {
    setBuyingType(type);
    toast({
      title: "Purchase Initiated",
      description: "Processing your purchase...",
    });

    try {
      await onBuy(type);
    } catch (e) {
      console.error(e);
      toast({
        title: "Purchase Failed",
        description: "Could not complete purchase. Please try again.",
        variant: "destructive",
      });
    } finally {
      setTimeout(() => setBuyingType(null), 2000);
    }
  };

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="font-pixel text-xs text-primary text-glow">Machine Shop</h2>
        <div className="flex gap-2">
          <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${atSlotLimit ? 'bg-destructive/20 text-destructive' : 'bg-secondary/50'}`}>
            <span>🔧</span>
            <span className="font-bold tabular-nums">{machines.length}/{maxSlots}</span>
          </div>
          <div className="flex items-center gap-1 bg-secondary/50 px-2 py-1 rounded-full text-xs">
            <span>🛢️</span>
            <span className="font-bold tabular-nums max-w-[80px] truncate">{formatCompactNumber(Math.floor(oilBalance))}</span>
          </div>
        </div>
      </div>

      {atSlotLimit ? (
        <div className="card-game rounded-xl p-4 border-2 border-destructive/50 bg-destructive/5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-destructive">Slot Limit Reached!</p>
              <p className="text-xs text-muted-foreground">Purchase more slots to buy machines.</p>
            </div>
            {canBuyMoreSlots && (
              <Button onClick={onBuySlots} className="glow-green">
                <Plus className="w-4 h-4 mr-1" />
                Buy +{slotConfig.slot_pack_size} Slots
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs px-1">
          Purchase mining machines to start earning minerals.
        </p>
      )}

      <div className="grid gap-4">
        {(Object.keys(config.machines) as MachineType[])
          .sort((a, b) => config.machines[a].cost_oil - config.machines[b].cost_oil)
          .map(type => {
            const template = config.machines[type];
            const owned = getMachineCount(type);
            // Check affordability based on currency type
            const isWldPurchase = (template.cost_wld || 0) > 0;
            const cost = isWldPurchase ? template.cost_wld : template.cost_oil;
            const canAfford = isWldPurchase ? true : oilBalance >= (template.cost_oil || 0);
            const isAffordableAndSlotAvailable = canAfford && !atSlotLimit;
            const isBuying = buyingType === type;

            return (
              <div
                key={type}
                className={`card-game rounded-xl p-4 transition-all duration-300 ${isAffordableAndSlotAvailable ? 'hover:glow-green' : 'opacity-60'
                  }`}
              >
                <div className="flex gap-4">
                  {/* Machine Icon */}
                  <div className="flex flex-col items-center justify-center">
                    <img src={getMachineIcon(type, config)} alt={type} className="w-12 h-12 animate-float object-contain" />
                    {owned > 0 && (
                      <span className="mt-2 text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full font-bold">
                        Owned: {owned}
                      </span>
                    )}
                  </div>

                  {/* Machine Details */}
                  <div className="flex-1">
                    <h3 className="font-bold mb-1 capitalize">{template.name || `${type} machine`}</h3>
                    <p className="text-muted-foreground text-xs mb-3">
                      Speed, fuel burn, and capacity scale with upgrades.
                    </p>

                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div className="flex items-center gap-1 text-xs bg-secondary/30 rounded px-2 py-1.5">
                        <Zap className="w-3 h-3 text-primary" />
                        <span className="text-muted-foreground">Speed:</span>
                        <span className="font-bold text-primary ml-auto">{template.speed_actions_per_hour}/hr</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs bg-secondary/30 rounded px-2 py-1.5">
                        <Clock className="w-3 h-3 text-accent" />
                        <span className="text-muted-foreground">Burn:</span>
                        <span className="font-bold text-accent ml-auto">{template.oil_burn_per_hour}/hr</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs bg-secondary/30 rounded px-2 py-1.5">
                        <Droplet className="w-3 h-3 text-primary" />
                        <span className="text-muted-foreground">Tank:</span>
                        <span className="font-bold text-primary ml-auto">{template.tank_capacity}</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs bg-secondary/30 rounded px-2 py-1.5">
                        <span className="text-muted-foreground">Max Lv:</span>
                        <span className="font-bold text-accent ml-auto">{template.max_level}</span>
                      </div>
                    </div>

                    {/* Price & Buy Button */}
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Price</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-primary text-lg font-pixel-small">W</span>
                          <span className={`font-bold text-lg ${canAfford ? 'text-primary' : 'text-white/40'}`}>
                            {(isWldPurchase ? template.cost_wld : template.cost_oil)?.toLocaleString()} <span className="text-xs">{isWldPurchase ? 'WLD' : 'OIL'}</span>
                          </span>
                        </div>
                      </div>
                      <Button
                        onClick={() => handleBuy(type)}
                        disabled={atSlotLimit || !canAfford || !!buyingType}
                        className={`${!atSlotLimit && canAfford ? 'glow-green' : ''}`}
                      >
                        {isBuying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShoppingCart className="w-4 h-4 mr-2" />}
                        {atSlotLimit ? 'No Slots' : isBuying ? 'Processing...' : 'Buy Now'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
};
