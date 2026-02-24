import { Machine, GameConfig, MachineType } from '@/types/game';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Play, Square, Droplet, Plus, Trash2, ArrowUpCircle } from 'lucide-react';
import { useMemo, useState, useEffect } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/components/ui/use-toast";
import miningMachineIcon from '@/assets/machines/mining-machine.png';
import heavyMachineIcon from '@/assets/machines/heavy-machine.png';
import lightMachineIcon from '@/assets/machines/light-machine.png';
import miniMachineIcon from '@/assets/machines/mini-machine.png';
import { formatCompactNumber } from '@/lib/format';
import { getUpgradeCost } from '@/hooks/useGameState';

interface FuelPopoverProps {
  machine: Machine;
  capacity: number;
  oilBalance: number;
  onFuel: (id: string, amount: number) => void;
}

const FuelPopover = ({ machine, capacity, oilBalance, onFuel }: FuelPopoverProps) => {
  const [amount, setAmount] = useState(0);
  const [open, setOpen] = useState(false);

  const maxFill = Math.max(0, capacity - machine.fuelOil);
  const maxPossible = Math.min(maxFill, oilBalance);

  useEffect(() => {
    if (open) {
      setAmount(Math.floor(maxPossible));
    }
  }, [open, maxPossible]);

  const adjust = (delta: number) => {
    setAmount(prev => Math.max(0, Math.min(Math.floor(maxPossible), prev + delta)));
  };

  const handleFuel = () => {
    if (amount > 0) {
      onFuel(machine.id, amount);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="secondary"
          className="h-8 text-xs transition-transform active:scale-95 glow-green"
          disabled={maxPossible <= 0}
        >
          <Droplet className="w-3 h-3 mr-1" />
          Fuel
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-3 bg-card border-border">
        <div className="space-y-3">
          <div className="flex justify-between text-xs">
            <span>Fuel Amount</span>
            <span className="text-muted-foreground">Max: {Math.floor(maxPossible)}</span>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => adjust(-10)}>-10</Button>
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => adjust(-1)}>-</Button>

            <div className="flex-1 text-center font-bold bg-secondary/30 rounded py-1.5 text-sm">
              {amount}
            </div>

            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => adjust(1)}>+</Button>
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => adjust(10)}>+10</Button>
          </div>

          <Button size="sm" className="w-full glow-green" onClick={handleFuel} disabled={amount <= 0}>
            Confirm ({amount} OIL)
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

interface MiningTabProps {
  userMachines: Machine[];
  config: GameConfig;
  oilBalance: number;
  maxSlots: number;
  onFuel: (id: string, amount?: number) => void;
  onStart: (id: string) => void;
  onStop?: (id: string) => void;
  onUpgrade?: (id: string) => void;
  onDiscard?: (id: string) => void;
  onBuySlots?: () => void;
}

// Deprecated: used as fallback
const DEFAULT_MACHINE_NAMES: Record<string, string> = {
  mini: 'Mini Machine',
  light: 'Light Machine',
  heavy: 'Heavy Machine',
  mega: 'Mega Machine',
};

const getMachineIcon = (type: string, config?: GameConfig) => {
  if (config?.machines[type]?.image_url) {
    // If it's a relative path starting with /, use origin. Otherwise assume full URL or require proper handling.
    // For now, assuming these are /assets/... paths or full URLs.
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

const getMultiplier = (base: number, level: number, perLevel: number) => {
  return base * (1 + Math.max(0, level - 1) * perLevel);
};

export const MiningTab = ({
  userMachines,
  config,
  oilBalance,
  onFuel,
  onStart,
  onStop,
  onUpgrade,
  onDiscard,
  maxSlots,
  onBuySlots
}: MiningTabProps) => {
  const machineStats = useMemo(() => {
    return userMachines.map(machine => {
      const def = config.machines[machine.type];
      const speed = getMultiplier(def.speed_actions_per_hour, machine.level, config.progression.level_speed_multiplier);
      const burn = getMultiplier(def.oil_burn_per_hour, machine.level, config.progression.level_oil_burn_multiplier);
      const capacity = getMultiplier(def.tank_capacity, machine.level, config.progression.level_capacity_multiplier);
      return { machine, speed, burn, capacity };
    });
  }, [userMachines, config]);

  const [discardId, setDiscardId] = useState<string | null>(null);
  const [upgradeId, setUpgradeId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { toast } = useToast();



  const confirmDiscard = () => {
    if (discardId && onDiscard) {
      setDeletingId(discardId);
      // Delay actual discard to show animation
      setTimeout(() => {
        onDiscard(discardId);
        setDiscardId(null);
        setDeletingId(null);
        toast({
          title: "Machine Discarded",
          description: "The machine has been permanently removed.",
          variant: "destructive",
        });
      }, 200);
    }
  };

  const confirmUpgrade = () => {
    if (upgradeId && onUpgrade) {
      onUpgrade(upgradeId);
      setUpgradeId(null);
      toast({
        title: "Upgrade Initiated",
        description: "Machine upgrade is in progress...",
      });
    }
  };

  const activeMachineForUpgrade = upgradeId ? userMachines.find(m => m.id === upgradeId) : null;
  const upgradeCost = activeMachineForUpgrade && config
    ? getUpgradeCost(config, activeMachineForUpgrade.type, activeMachineForUpgrade.level)
    : 0;

  const atSlotLimit = userMachines.length >= maxSlots;
  const slotConfig = config.slots ?? { base_slots: 10, max_total_slots: 30, slot_pack_price_wld: 1, slot_pack_size: 5 };
  const canBuyMoreSlots = maxSlots < slotConfig.max_total_slots && onBuySlots;

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="font-pixel text-xs text-primary text-glow">Your Machines</h2>
        <div className="flex items-center gap-2">
          {atSlotLimit && (
            <div className="flex items-center gap-1 bg-destructive/20 text-destructive px-2 py-1 rounded-full text-xs animate-pulse">
              <span>🔧</span>
              <span className="font-bold">{userMachines.length}/{maxSlots}</span>
            </div>
          )}
          <div className="flex items-center gap-1 bg-secondary/50 px-3 py-1.5 rounded-full">
            <span className="text-game-oil">🛢️</span>
            <span className="text-sm font-bold tabular-nums max-w-[100px] truncate">{formatCompactNumber(Math.floor(oilBalance))}</span>
          </div>
        </div>
      </div>

      {atSlotLimit && (
        <div className="card-game rounded-xl p-3 border-2 border-destructive/50 bg-destructive/5 mb-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-destructive">Slot Limit Reached!</p>
              <p className="text-[10px] text-muted-foreground">Expand capacity to mine more.</p>
            </div>
            {canBuyMoreSlots && (
              <Button onClick={onBuySlots} size="sm" className="h-8 text-xs glow-green shrink-0">
                <Plus className="w-3 h-3 mr-1" />
                Buy +{slotConfig.slot_pack_size} Slots
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Render Machines */}
      {machineStats.map(({ machine, speed, burn, capacity }) => {
        const fuelPercent = capacity > 0 ? Math.min(100, (machine.fuelOil / capacity) * 100) : 0;
        const canFuel = machine.fuelOil < capacity && oilBalance > 0;

        return (
          <div
            key={machine.id}
            className={`card-game rounded-xl p-4 transition-all duration-300 animate-in fade-in zoom-in duration-300 ${machine.isActive ? 'glow-green' : ''
              } ${deletingId === machine.id ? 'opacity-0 scale-95 translate-y-4' : 'opacity-100 scale-100'}`}
          >
            <div className="flex gap-4">
              {/* Machine Icon & Status */}
              <div className="flex flex-col items-center">
                <div className={`relative w-12 h-12 flex items-center justify-center ${machine.isActive ? 'animate-mining' : ''}`}>
                  <img src={getMachineIcon(machine.type, config)} alt={machine.type} className="w-full h-full object-contain" />
                </div>
                <div className={`mt-2 px-2 py-0.5 rounded text-xs font-bold ${machine.isActive
                  ? 'bg-primary/20 text-primary'
                  : 'bg-muted text-muted-foreground'
                  }`}>
                  {machine.isActive ? 'MINING' : 'IDLE'}
                </div>
              </div>

              {/* Machine Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-sm truncate">{config.machines[machine.type]?.name || DEFAULT_MACHINE_NAMES[machine.type] || machine.type}</h3>
                  <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded font-bold">
                    Lv.{machine.level}/{config.machines[machine.type].max_level}
                  </span>
                </div>

                {/* Fuel Progress */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Droplet className="w-3 h-3" /> Fuel
                    </span>
                    <span className="text-muted-foreground">
                      {machine.fuelOil.toFixed(1)} / {capacity.toFixed(1)} OIL
                    </span>
                  </div>
                  <Progress value={fuelPercent} className="h-2" />
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                  <div className="bg-secondary/30 rounded px-2 py-1">
                    <span className="text-muted-foreground">Speed:</span>
                    <span className="ml-1 text-primary font-bold">{speed.toFixed(1)}/hr</span>
                  </div>
                  <div className="bg-secondary/30 rounded px-2 py-1">
                    <span className="text-muted-foreground">Burn:</span>
                    <span className="ml-1 text-accent font-bold">{burn.toFixed(1)}/hr</span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 flex-wrap">
                  {machine.isActive ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="flex-1 h-8 text-xs transition-transform active:scale-95"
                      onClick={() => onStop?.(machine.id)}
                    >
                      <Square className="w-3 h-3 mr-1" />
                      Stop
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="default"
                      className="flex-1 h-8 text-xs glow-green transition-transform active:scale-95"
                      onClick={() => onStart(machine.id)}
                      disabled={machine.fuelOil <= 0}
                    >
                      <Play className="w-3 h-3 mr-1" />
                      Start
                    </Button>
                  )}

                  <FuelPopover
                    machine={machine}
                    capacity={capacity}
                    oilBalance={oilBalance}
                    onFuel={(id, amount) => {
                      onFuel(id, amount);
                      toast({
                        title: "Refueling Initiated",
                        description: `Adding ${amount} OIL...`,
                        duration: 2000,
                      });
                    }}
                  />

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 text-xs border-accent text-accent hover:bg-accent/20 font-bold"
                    onClick={() => setUpgradeId(machine.id)}
                    disabled={machine.level >= config.machines[machine.type].max_level}
                    title="Upgrade"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>

                  {/* Discard Button */}
                  {onDiscard && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 w-8 text-xs border-destructive text-destructive hover:bg-destructive/20"
                      onClick={() => {
                        setDiscardId(machine.id);
                      }}
                      title="Discard Machine (No Refund)"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Render Empty Slot Skeletons */}
      {Array.from({ length: Math.max(0, maxSlots - userMachines.length) }).map((_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: Static skeletons based on length
          key={`empty-slot-${i}`}
          className="card-game rounded-xl p-4 border-dashed border-2 border-white/5 bg-white/5 hover:bg-white/10 transition-colors cursor-pointer group"
          onClick={onBuySlots}
        >
          <div className="flex items-center gap-4 opacity-40 group-hover:opacity-100 transition-opacity">
            <div className="w-12 h-12 rounded bg-white/5 flex items-center justify-center">
              <Plus className="w-6 h-6 text-white/20" />
            </div>
            <div className="flex-1">
              <div className="h-4 w-24 bg-white/10 rounded mb-2" />
              <div className="h-3 w-32 bg-white/5 rounded" />
            </div>
            <div className="text-[10px] font-pixel text-primary/50 group-hover:text-primary transition-colors">
              +{slotConfig.slot_pack_size} SLOTS
            </div>
          </div>
        </div>
      ))}
      {/* Discard Alert Dialog */}
      <AlertDialog open={!!discardId} onOpenChange={(open) => !open && setDiscardId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Machine?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to discard this machine? You will <span className="text-destructive font-bold">NOT</span> get any refund.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscard} className="bg-destructive hover:bg-destructive/90">
              Confirm Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Upgrade Alert Dialog */}
      <AlertDialog open={!!upgradeId} onOpenChange={(open) => !open && setUpgradeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Upgrade Machine</AlertDialogTitle>
            <AlertDialogDescription>
              Upgrade this machine to Level {activeMachineForUpgrade ? activeMachineForUpgrade.level + 1 : ''}?
              <div className="bg-secondary/20 rounded-lg p-3 my-3 space-y-2 text-xs">
                {activeMachineForUpgrade && config && (() => {
                  const m = activeMachineForUpgrade;
                  const def = config.machines[m.type];
                  const nextLvl = m.level + 1;

                  const currSpeed = getMultiplier(def.speed_actions_per_hour, m.level, config.progression.level_speed_multiplier);
                  const nextSpeed = getMultiplier(def.speed_actions_per_hour, nextLvl, config.progression.level_speed_multiplier);

                  const currBurn = getMultiplier(def.oil_burn_per_hour, m.level, config.progression.level_oil_burn_multiplier);
                  const nextBurn = getMultiplier(def.oil_burn_per_hour, nextLvl, config.progression.level_oil_burn_multiplier);

                  const currCap = getMultiplier(def.tank_capacity, m.level, config.progression.level_capacity_multiplier);
                  const nextCap = getMultiplier(def.tank_capacity, nextLvl, config.progression.level_capacity_multiplier);

                  return (
                    <>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Mining Speed:</span>
                        <div className="flex items-center gap-2">
                          <span>{currSpeed.toFixed(1)}/hr</span>
                          <ArrowUpCircle className="w-3 h-3 text-primary animate-bounce-x" />
                          <span className="text-primary font-bold">{nextSpeed.toFixed(1)}/hr</span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Tank Capacity:</span>
                        <div className="flex items-center gap-2">
                          <span>{currCap.toFixed(0)}</span>
                          <ArrowUpCircle className="w-3 h-3 text-primary" />
                          <span className="text-primary font-bold">{nextCap.toFixed(0)}</span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Oil Burn:</span>
                        <div className="flex items-center gap-2">
                          <span>{currBurn.toFixed(1)}/hr</span>
                          <ArrowUpCircle className="w-3 h-3 text-accent" />
                          <span className="text-accent font-bold">{nextBurn.toFixed(1)}/hr</span>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
              <div className="flex justify-between items-center border-t border-white/10 pt-2">
                <span className="text-muted-foreground">Upgrade Cost:</span>
                <span className="text-primary font-bold text-sm">{formatCompactNumber(upgradeCost)} OIL</span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmUpgrade} disabled={oilBalance < upgradeCost}>
              {oilBalance < upgradeCost ? 'Oil is low, please recharge!' : 'Confirm Upgrade'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
