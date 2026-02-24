import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchGameState,
  gameAction,
  fetchConfig,
  updateProfile,
  authHeaders,
  initiateSlotPurchase,
  confirmSlotPurchase,
  initiateMachinePurchase,
  confirmMachinePurchase,
} from '@/lib/backend';
import { MiniKit, Tokens, tokenToDecimals, type PayCommandInput } from '@worldcoin/minikit-js';
import { ensureMiniKit, getMiniKitErrorMessage } from '@/lib/minikit';
import { clearSession, getSession } from '@/lib/session';
import { GameConfig, Machine, PlayerState, GameStateResponse, MachineType, MineralType } from '@/types/game';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/error';

interface PayCommandResult {
  finalPayload: {
    status: 'success' | 'failed';
    [key: string]: unknown;
  };
}

const defaultMinerals: Record<MineralType, number> = {
  bronze: 0,
  silver: 0,
  gold: 0,
  iron: 0,
};

const mapState = (response: GameStateResponse) => {
  const state: PlayerState = {
    oilBalance: Number(response.state.oil_balance || 0),
    diamondBalance: Number(response.state.diamond_balance || 0),
    minerals: { ...defaultMinerals, ...(response.state.minerals || {}) },
    purchasedSlots: Number(response.state.purchased_slots || 0),
    maxSlots: Number(response.state.max_slots || 10),
    lastDailyClaim: response.state.last_daily_claim,
    lastCashout: response.state.last_cashout,
  };

  const machines: Machine[] = response.machines.map((m) => ({
    id: m.id,
    type: m.type,
    level: m.level,
    fuelOil: Number(m.fuel_oil || 0),
    isActive: Boolean(m.is_active),
    lastProcessedAt: m.last_processed_at ?? null,
  }));

  return { state, machines, config: response.config };
};

const getMultiplier = (base: number, level: number, perLevel: number) => {
  return base * (1 + Math.max(0, level - 1) * perLevel);
};

const getTankCapacity = (config: GameConfig, type: MachineType, level: number) => {
  const def = config.machines[type];
  return getMultiplier(def.tank_capacity, level, config.progression.level_capacity_multiplier);
};

export const getUpgradeCost = (config: GameConfig, type: MachineType, level: number) => {
  const def = config.machines[type];
  return Math.floor(def.cost_oil * level * config.progression.upgrade_cost_multiplier);
};

export const useGameState = () => {
  const navigate = useNavigate();
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [player, setPlayer] = useState<PlayerState>({
    oilBalance: 0,
    diamondBalance: 0,
    minerals: defaultMinerals,
    purchasedSlots: 0,
    maxSlots: 10,
  });
  const [machines, setMachines] = useState<Machine[]>([]);
  const [profile, setProfile] = useState<{ playerName?: string; isAdmin?: boolean; isHumanVerified?: boolean; referralCode?: string; referralCount?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Prevent concurrent refreshes while a mutation is in-flight (avoids UI lag + DB row lock contention).
  const isFetchingRef = useRef(false);
  const isMutatingRef = useRef(false);
  const initialFetchDoneRef = useRef(false);
  const mutationSeqRef = useRef(0);
  const actionQueueRef = useRef<Promise<void>>(Promise.resolve());

  const configRef = useRef<GameConfig | null>(null);
  const playerRef = useRef<PlayerState>(player);
  const machinesRef = useRef<Machine[]>(machines);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  useEffect(() => {
    machinesRef.current = machines;
  }, [machines]);

  const handleAuthFailure = useCallback((message: string) => {
    if (/session expired|invalid session token|missing authorization|missing app session token/i.test(message)) {
      clearSession();
      navigate('/auth', { replace: true });
      return true;
    }
    return false;
  }, [navigate]);

  const refresh = useCallback(async (showLoading = false, force = false) => {
    // Prevent concurrent refreshes unless forced
    if (isFetchingRef.current && !force) return;
    // Avoid racing refreshes with actions (they touch the same rows) unless forced
    if (isMutatingRef.current && !force) return;

    const session = getSession();
    if (!session) {
      setLoading(false);
      return;
    }

    isFetchingRef.current = true;
    const mutationSeqAtStart = mutationSeqRef.current;
    if (showLoading) setLoading(true);
    setError(null);

    try {
      const response = await fetchGameState();
      // If a mutation started while this refresh was in-flight, ignore the result to avoid stale overwrites.
      if (mutationSeqAtStart !== mutationSeqRef.current) return;
      const mapped = mapState(response);
      setConfig(mapped.config);
      setPlayer(mapped.state);
      setMachines(mapped.machines);
      if (response.profile) {
        setProfile({
          playerName: response.profile.player_name || 'Miner',
          isAdmin: Boolean(response.profile.is_admin),
          isHumanVerified: Boolean(response.profile.is_human_verified),
          referralCode: response.profile.referral_code,
          referralCount: response.profile.referral_count || 0,
        });
      }
    } catch (err) {
      const message = getErrorMessage(err);
      if (!handleAuthFailure(message)) {
        setError(message);
      }
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, [handleAuthFailure]);

  // Initial fetch only - runs once
  useEffect(() => {
    if (!initialFetchDoneRef.current) {
      initialFetchDoneRef.current = true;
      refresh(true);
    }
  }, [refresh]);

  // Single polling effect with visibility-aware interval
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;

    const startPolling = () => {
      if (intervalId) clearInterval(intervalId);

      // Poll every 10s when visible, 60s when hidden (reduced from 5s/30s)
      const isVisible = document.visibilityState === 'visible';
      const delay = isVisible ? 10000 : 60000;

      intervalId = setInterval(() => {
        refresh(false); // Don't show loading spinner for background refreshes
      }, delay);
    };

    const handleVisibilityChange = () => {
      startPolling();
      if (document.visibilityState === 'visible') {
        refresh(false); // Immediate refresh when returning to tab
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    startPolling();

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refresh]);

  const executeAction = useCallback(async (action: string, payload?: Record<string, unknown>) => {
    const machineId = (payload?.machineId as string | undefined) ?? undefined;

    const runAction = async () => {
      console.log('useGameState: executeAction started:', action, payload);
      isMutatingRef.current = true;
      mutationSeqRef.current += 1;
      const prevPlayer = playerRef.current;
      const prevMachines = machinesRef.current;
      const prevMachine = machineId ? prevMachines.find((m) => m.id === machineId) : undefined;
      const prevIsActive = prevMachine?.isActive;
      const prevLastProcessedAt = prevMachine?.lastProcessedAt;
      const prevFuelOil = prevMachine?.fuelOil;

      const nowIso = new Date().toISOString();

      // Optimistic UX for common actions so the app feels responsive.
      if (machineId && action === 'start_machine') {
        setMachines((prev) => prev.map((m) => (m.id === machineId ? { ...m, isActive: true, lastProcessedAt: nowIso } : m)));
      }

      if (machineId && action === 'stop_machine') {
        setMachines((prev) => prev.map((m) => (m.id === machineId ? { ...m, isActive: false, lastProcessedAt: nowIso } : m)));
      }

      if (machineId && action === 'discard_machine') {
        setMachines((prev) => prev.filter((m) => m.id !== machineId));
      }

      let didOptimisticallyChangePlayer = false;

      if (machineId && action === 'fuel_machine') {
        const cfg = configRef.current;
        if (cfg && prevMachine) {
          const capacity = getTankCapacity(cfg, prevMachine.type, prevMachine.level);
          const needed = Math.max(0, capacity - prevMachine.fuelOil);
          const rawAmount = payload?.amount;
          const requested = typeof rawAmount === 'number' ? rawAmount : needed;
          const fillAmount = Math.min(needed, requested, prevPlayer.oilBalance);

          if (fillAmount > 0) {
            setMachines((prev) => prev.map((m) => (m.id === machineId ? { ...m, fuelOil: m.fuelOil + fillAmount } : m)));
            setPlayer((prev) => ({ ...prev, oilBalance: Math.max(0, prev.oilBalance - fillAmount) }));
            didOptimisticallyChangePlayer = true;
          }
        } else if (typeof payload?.amount === 'number' && payload.amount > 0 && prevPlayer.oilBalance >= payload.amount && prevMachine) {
          // Fallback: no config yet (tests / edge), still apply the requested amount optimistically
          const fillAmount = payload.amount;
          setMachines((prev) => prev.map((m) => (m.id === machineId ? { ...m, fuelOil: m.fuelOil + fillAmount } : m)));
          setPlayer((prev) => ({ ...prev, oilBalance: Math.max(0, prev.oilBalance - fillAmount) }));
          didOptimisticallyChangePlayer = true;
        }
      }

      if (machineId && action === 'upgrade_machine') {
        const cfg = configRef.current;
        if (cfg && prevMachine) {
          const maxLevel = cfg.machines[prevMachine.type].max_level;
          if (prevMachine.level < maxLevel) {
            const cost = getUpgradeCost(cfg, prevMachine.type, prevMachine.level);
            if (prevPlayer.oilBalance >= cost) {
              setMachines((prev) => prev.map((m) => (m.id === machineId ? { ...m, level: m.level + 1 } : m)));
              setPlayer((prev) => ({ ...prev, oilBalance: Math.max(0, prev.oilBalance - cost) }));
              didOptimisticallyChangePlayer = true;
            }
          }
        }
      }

      try {
        const result = await gameAction(action, payload);

        if (result?.state) {
          setPlayer((prev) => ({
            ...prev,
            oilBalance: Number(result.state.oil_balance ?? prev.oilBalance),
            diamondBalance: Number(result.state.diamond_balance ?? prev.diamondBalance),
            minerals: { ...defaultMinerals, ...(result.state.minerals ?? prev.minerals) },
          }));
        }

        if (result?.machines) {
          setMachines(
            result.machines.map((m) => ({
              id: m.id,
              type: m.type,
              level: m.level,
              fuelOil: Number(m.fuel_oil || 0),
              isActive: Boolean(m.is_active),
              lastProcessedAt: m.last_processed_at ?? null,
            }))
          );
        }

        // Success Toasts
        if (action === 'buy_machine') {
          toast({ title: 'Machine Purchased!', description: `You bought a ${payload?.machineType} machine.`, className: 'glow-green' });
        } else if (action === 'upgrade_machine') {
          toast({ title: 'Upgrade Complete!', description: 'Machine upgraded successfully.', className: 'glow-green' });
        } else if (action === 'fuel_machine') {
          toast({ title: 'Refueled!', description: 'Machine tank refilled.', className: 'glow-green' });
        } else if (action === 'exchange_minerals') {
          toast({ title: 'Exchange Successful!', description: 'Minerals exchanged for OIL.', className: 'glow-green' });
        } else if (action === 'start_machine') {
          toast({ title: 'Mining Started!', description: 'Machine is now active.', className: 'glow-green' });
        } else if (action === 'stop_machine') {
          toast({ title: 'Mining Stopped', description: 'Machine halted.' });
        } else if (action === 'discard_machine') {
          toast({
            title: 'Machine Discarded',
            description: 'Machine removed. Slot freed.',
            className: 'text-destructive',
          });
        }
      } catch (err) {
        const message = getErrorMessage(err);
        if (handleAuthFailure(message)) return;

        // Revert optimistic changes on failure.
        if (machineId && prevMachine) {
          setMachines((prev) => {
            const alreadyExists = prev.find((m) => m.id === machineId);

            if (action === 'discard_machine' && !alreadyExists) {
              return [...prev, prevMachine].sort((a, b) => a.id.localeCompare(b.id));
            }

            return prev.map((m) =>
              m.id === machineId
                ? {
                  ...m,
                  isActive: Boolean(prevIsActive),
                  lastProcessedAt: prevLastProcessedAt ?? null,
                  fuelOil: Number(prevFuelOil),
                  level: prevMachine.level,
                }
                : m
            );
          });
        }

        if (didOptimisticallyChangePlayer) {
          setPlayer(prevPlayer);
        }

        toast({
          title: 'Action Failed',
          description: message,
          variant: 'destructive',
        });
      } finally {
        isMutatingRef.current = false;
      }
    };

    // Serialize actions to avoid backend contention + out-of-order overwrites.
    const queued = actionQueueRef.current.then(runAction, runAction);
    actionQueueRef.current = queued.catch(() => { });
    return queued;
  }, [toast, handleAuthFailure]);

  const buyMachine = async (type: MachineType) => {
    const miniKit = ensureMiniKit();
    if (!miniKit.ok) {
      toast({
        title: 'World App required',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        description: getMiniKitErrorMessage((miniKit as any).reason),
        variant: 'destructive',
      });
      return false;
    }

    setLoading(true);
    try {
      const init = await initiateMachinePurchase(type);

      const payPayload: PayCommandInput = {
        reference: init.reference,
        to: init.to_address,
        tokens: [
          {
            symbol: Tokens.WLD,
            token_amount: tokenToDecimals(init.amount_wld, Tokens.WLD).toString(),
          },
        ],
        description: init.description,
      };

      const { finalPayload } = (await MiniKit.commandsAsync.pay(payPayload)) as PayCommandResult;

      if (finalPayload.status !== 'success') {
        throw new Error('Payment cancelled');
      }

      const result = await confirmMachinePurchase(finalPayload);

      if (result.ok) {
        toast({
          title: 'Machine Purchased!',
          description: result.message,
          className: 'glow-green',
        });

        // Refresh to get the new machine
        await refresh(true);
        return true;
      } else {
        throw new Error('Purchase confirmation failed');
      }
    } catch (err: unknown) {
      toast({
        title: 'Purchase Failed',
        description: (err as Error)?.message || 'Unable to buy machine',
        variant: 'destructive',
      });
      return false;
    } finally {
      setLoading(false);
    }
  };

  const fuelMachine = useCallback((machineId: string, amount?: number) => executeAction('fuel_machine', { machineId, amount }), [executeAction]);
  const startMachine = useCallback((machineId: string) => executeAction('start_machine', { machineId }), [executeAction]);
  const stopMachine = useCallback((machineId: string) => executeAction('stop_machine', { machineId }), [executeAction]);
  const upgradeMachine = useCallback((machineId: string) => executeAction('upgrade_machine', { machineId }), [executeAction]);
  const discardMachine = useCallback((machineId: string) => executeAction('discard_machine', { machineId }), [executeAction]);
  const exchangeMineral = useCallback((mineral: MineralType, amount: number) => executeAction('exchange_minerals', { mineral, amount }), [executeAction]);

  const mutateState = useCallback((updater: (prev: PlayerState) => PlayerState) => {
    setPlayer(updater);
  }, []);

  const buySlots = async () => {
    const miniKit = ensureMiniKit();
    if (!miniKit.ok) {
      toast({
        title: 'World App required',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        description: getMiniKitErrorMessage((miniKit as any).reason),
        variant: 'destructive',
      });
      return false;
    }

    setLoading(true);
    try {
      const init = await initiateSlotPurchase();

      const payPayload: PayCommandInput = {
        reference: init.reference,
        to: init.to_address,
        tokens: [
          {
            symbol: Tokens.WLD,
            token_amount: tokenToDecimals(init.amount_wld, Tokens.WLD).toString(),
          },
        ],
        description: init.description,
      };

      const { finalPayload } = (await MiniKit.commandsAsync.pay(payPayload)) as PayCommandResult;

      if (finalPayload.status !== 'success') {
        throw new Error('Payment cancelled');
      }

      const result = await confirmSlotPurchase(finalPayload);

      if (result.ok) {
        toast({
          title: 'Slots Purchased!',
          description: `You bought ${result.slots_added} machine slots.`,
          className: 'glow-green',
        });

        // Optimistic update
        setPlayer((prev) => ({
          ...prev,
          purchasedSlots: (prev.purchasedSlots || 0) + result.slots_added,
          maxSlots: (prev.maxSlots || 10) + result.slots_added,
        }));

        // Refresh to be sure
        await refresh(true);
        return true;
      } else {
        throw new Error('Purchase confirmation failed');
      }
    } catch (err: unknown) {
      toast({
        title: 'Slot Purchase Failed',
        description: (err as Error)?.message || 'Unable to complete purchase',
        variant: 'destructive',
      });
      return false;
    } finally {
      setLoading(false);
    }
  };

  return {
    config,
    player,
    machines,
    loading,
    error,
    profile,
    buyMachine,
    fuelMachine,
    startMachine,
    stopMachine,
    upgradeMachine,
    discardMachine,
    exchangeMineral,
    refresh,
    mutateState: setPlayer,
    buySlots,
  };
};
