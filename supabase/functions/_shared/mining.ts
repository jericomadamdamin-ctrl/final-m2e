import { getAdminClient } from './supabase.ts';

type GameConfig = {
  pricing: { oil_per_wld: number; oil_per_usdc: number; usdc_to_wld_rate?: number };
  machines: Record<string, { cost_oil: number; cost_wld?: number; speed_actions_per_hour: number; oil_burn_per_hour: number; tank_capacity: number; max_level: number; name?: string; image_url?: string }>;
  mining: { action_rewards: { minerals: Record<string, { drop_rate: number; oil_value: number }>; diamond: { drop_rate_per_action: number } } };
  diamond_controls: { daily_cap_per_user: number; excess_diamond_oil_value: number };
  progression: { level_speed_multiplier: number; level_oil_burn_multiplier: number; level_capacity_multiplier: number; upgrade_cost_multiplier: number };
  cashout?: {
    enabled: boolean;
    minimum_diamonds_required: number;
    cooldown_days: number;
    tax_rate_percent?: number;
    diamond_wld_exchange_rate?: number;
  };
  treasury?: { payout_percentage: number; treasury_address?: string | null };
  anti_abuse?: { rate_limits?: { cashout_requests_per_day?: number } };
  referrals?: { bonus_diamonds: number };
  global_game_settings?: { daily_oil_reward?: number; welcome_bonus_oil?: number };
};

type PlayerStateRow = {
  user_id: string;
  oil_balance: number;
  diamond_balance: number;
  minerals: Record<string, number>;
  daily_diamond_count: number;
  daily_diamond_reset_at: string;
};

type MachineRow = {
  id: string;
  user_id?: string;
  type: string;
  level: number;
  fuel_oil: number;
  is_active: boolean;
  last_processed_at: string | null;
  action_remainder?: number | null;
};

const MS_PER_HOUR = 3600 * 1000;

const getMultiplier = (base: number, level: number, perLevel: number) => {
  return base * (1 + Math.max(0, level - 1) * perLevel);
};

export async function getGameConfig(): Promise<GameConfig> {
  const admin = getAdminClient();
  const { data: configData, error: configError } = await admin
    .from('game_config')
    .select('value')
    .eq('key', 'current')
    .single();

  if (configError || !configData) {
    throw new Error('Missing game_config');
  }

  const config = configData.value as GameConfig;

  // 1. Fetch Machine Tiers
  const { data: machinesData } = await admin
    .from('machine_tiers')
    .select('*')
    .eq('is_enabled', true);

  if (machinesData && (machinesData as any[]).length > 0) {
    (machinesData as any[]).forEach((m) => {
      config.machines[m.id] = {
        cost_oil: Number(m.cost_oil),
        cost_wld: Number(m.cost_wld || 0),
        speed_actions_per_hour: Number(m.speed_actions_per_hour),
        oil_burn_per_hour: Number(m.oil_burn_per_hour),
        tank_capacity: Number(m.tank_capacity),
        max_level: Number(m.max_level),
        name: m.name,
        image_url: m.image_url,
      };
    });
  }

  // 2. Fetch Mineral Configs
  const { data: mineralData } = await admin
    .from('mineral_configs')
    .select('*');

  if (mineralData && (mineralData as any[]).length > 0) {
    (mineralData as any[]).forEach((m) => {
      config.mining.action_rewards.minerals[m.id] = {
        drop_rate: Number(m.drop_rate),
        oil_value: Number(m.oil_value),
      };
    });
  }

  // 3. Fetch Global Settings
  const { data: settingsData } = await admin
    .from('global_game_settings')
    .select('*');

  if (settingsData && (settingsData as any[]).length > 0) {
    (settingsData as any[]).forEach((s) => {
      switch (s.key) {
        case 'diamond_drop_rate':
          config.mining.action_rewards.diamond.drop_rate_per_action = Number(s.value);
          break;
        case 'upgrade_cost_multiplier':
          config.progression.upgrade_cost_multiplier = Number(s.value);
          break;
        case 'daily_diamond_cap':
          config.diamond_controls.daily_cap_per_user = Number(s.value);
          break;
        case 'oil_per_wld':
          config.pricing.oil_per_wld = Number(s.value);
          break;
        case 'payout_percentage':
          if (config.treasury) config.treasury.payout_percentage = Number(s.value);
          break;
        case 'daily_oil_reward':
          config.global_game_settings = config.global_game_settings || {};
          config.global_game_settings.daily_oil_reward = Number(s.value);
          break;
        case 'welcome_bonus_oil':
          config.global_game_settings = config.global_game_settings || {};
          config.global_game_settings.welcome_bonus_oil = Number(s.value);
          break;
        case 'diamond_wld_exchange_rate':
          config.cashout = config.cashout || { enabled: true, minimum_diamonds_required: 0, cooldown_days: 0 };
          config.cashout.diamond_wld_exchange_rate = Number(s.value);
          break;
      }
    });
  }

  return config;
}

export async function ensurePlayerState(userId: string): Promise<PlayerStateRow> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('player_state')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (data && !error) {
    return data as PlayerStateRow;
  }

  // Fetch welcome bonus (if configured)
  const { data: bonusData } = await admin
    .from('global_game_settings')
    .select('value')
    .eq('key', 'welcome_bonus_oil')
    .single();

  const startingOil = Number(bonusData?.value || 0);

  const { data: created, error: createError } = await admin
    .from('player_state')
    .insert({
      user_id: userId,
      oil_balance: startingOil, // Apply welcome bonus
    })
    .select('*')
    .single();

  if (createError || !created) {
    throw new Error('Failed to create player state');
  }

  // Grant a free starter Mini Machine for new players
  try {
    await admin.from('player_machines').insert({
      user_id: userId,
      type: 'mini',
      level: 1,
      fuel_oil: 0,
      is_active: false,
    });
    console.log(`[ensurePlayerState] Granted free starter mini machine to ${userId}`);
  } catch (e) {
    console.warn('[ensurePlayerState] Failed to grant starter machine (may already exist):', (e as Error).message);
  }

  return created as PlayerStateRow;
}

export async function getPlayerMachines(userId: string): Promise<MachineRow[]> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('player_machines')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error('Failed to fetch machines');
  }
  return (data ?? []) as MachineRow[];
}

export async function processMining(
  userId: string,
  opts?: { config?: GameConfig; state?: PlayerStateRow; machines?: MachineRow[] },
) {
  const admin = getAdminClient();
  const config = opts?.config ?? await getGameConfig();
  const state = opts?.state ?? await ensurePlayerState(userId);
  const machines = opts?.machines ?? await getPlayerMachines(userId);

  const mineralDefaults = Object.fromEntries(Object.keys(config.mining.action_rewards.minerals).map((key) => [key, 0])) as Record<string, number>;
  const minerals = { ...mineralDefaults, ...(state.minerals || {}) } as Record<string, number>;
  let oilBalance = Number(state.oil_balance);
  let diamondBalance = Number(state.diamond_balance);
  let dailyCount = Number(state.daily_diamond_count);
  let resetAt = new Date(state.daily_diamond_reset_at).getTime();

  const now = Date.now();
  if (now - resetAt >= 24 * MS_PER_HOUR) {
    dailyCount = 0;
    resetAt = now;
  }

  const diamondCap = config.diamond_controls.daily_cap_per_user;
  const excessDiamondOilValue = config.diamond_controls.excess_diamond_oil_value ?? 0;
  const diamondDrop = config.mining.action_rewards.diamond.drop_rate_per_action;
  const mineralDefs = config.mining.action_rewards.minerals;

  const machineUpdates: {
    id: string;
    user_id: string;
    type: string;
    level: number;
    fuel_oil: number;
    is_active: boolean;
    last_processed_at: string | null;
    action_remainder: number;
  }[] = [];

  for (const machine of machines) {
    if (!machine.is_active) continue;
    if (!machine.last_processed_at) {
      machineUpdates.push({
        id: machine.id,
        user_id: userId,
        type: machine.type,
        level: machine.level,
        fuel_oil: machine.fuel_oil,
        is_active: machine.is_active,
        last_processed_at: new Date(now).toISOString(),
        action_remainder: Number(machine.action_remainder ?? 0),
      });
      continue;
    }

    const last = new Date(machine.last_processed_at).getTime();
    const elapsedMs = now - last;
    if (elapsedMs <= 0) continue;

    const configMachine = config.machines[machine.type];
    if (!configMachine) continue;

    const speed = getMultiplier(configMachine.speed_actions_per_hour, machine.level, config.progression.level_speed_multiplier);
    const burn = getMultiplier(configMachine.oil_burn_per_hour, machine.level, config.progression.level_oil_burn_multiplier);

    const elapsedHours = elapsedMs / MS_PER_HOUR;
    const maxHoursByFuel = burn > 0 ? machine.fuel_oil / burn : 0;
    const effectiveHours = Math.min(elapsedHours, maxHoursByFuel);

    if (effectiveHours <= 0) {
      machineUpdates.push({
        id: machine.id,
        user_id: userId,
        type: machine.type,
        level: machine.level,
        fuel_oil: machine.fuel_oil,
        is_active: false,
        last_processed_at: machine.last_processed_at,
        action_remainder: Number(machine.action_remainder ?? 0),
      });
      continue;
    }

    const oilUsed = effectiveHours * burn;
    const fuelRemaining = Math.max(0, machine.fuel_oil - oilUsed);

    // Accumulate fractional actions so frequent polling doesn't "burn time" without rewards.
    const prevRemainder = Number(machine.action_remainder ?? 0);
    const totalActionProgress = prevRemainder + effectiveHours * speed;
    const actions = Math.floor(totalActionProgress);
    const actionRemainder = totalActionProgress - actions; // [0, 1)

    if (actions > 0) {
      for (let i = 0; i < actions; i++) {
        for (const [mineral, def] of Object.entries(mineralDefs)) {
          if (Math.random() < def.drop_rate) {
            minerals[mineral] = (minerals[mineral] || 0) + 1;
          }
        }
        if (Math.random() < diamondDrop) {
          if (dailyCount < diamondCap) {
            diamondBalance += 1;
            dailyCount += 1;
          } else if (excessDiamondOilValue > 0) {
            oilBalance += excessDiamondOilValue;
          }
        }
      }
    }

    const newLast = new Date(last + effectiveHours * MS_PER_HOUR).toISOString();
    machineUpdates.push({
      id: machine.id,
      user_id: userId,
      type: machine.type,
      level: machine.level,
      fuel_oil: fuelRemaining,
      is_active: fuelRemaining > 0,
      last_processed_at: newLast,
      action_remainder: actionRemainder,
    });
  }

  await admin
    .from('player_state')
    .update({
      minerals,
      oil_balance: oilBalance,
      diamond_balance: diamondBalance,
      daily_diamond_count: dailyCount,
      daily_diamond_reset_at: new Date(resetAt).toISOString(),
      last_active_at: new Date(now).toISOString(),
    })
    .eq('user_id', userId);

  // Track diamonds earned this tick for the seasonal leaderboard
  const diamondsEarned = diamondBalance - Number(state.diamond_balance);
  if (diamondsEarned > 0) {
    try {
      await admin.rpc('upsert_seasonal_diamonds', {
        p_user_id: userId,
        p_diamonds_added: diamondsEarned,
      });
    } catch (e) {
      console.warn('[processMining] seasonal leaderboard update failed:', (e as Error).message);
    }
  }

  if (machineUpdates.length > 0) {
    const { error: upsertError } = await admin
      .from('player_machines')
      .upsert(machineUpdates, { onConflict: 'id' });
    if (upsertError) {
      throw new Error('Failed to update machines');
    }
  }

  const updatesById = new Map(machineUpdates.map((u) => [u.id, u]));
  const refreshedMachines = machines.map((m) => {
    const u = updatesById.get(m.id);
    return u
      ? {
        ...m,
        fuel_oil: u.fuel_oil,
        is_active: u.is_active,
        last_processed_at: u.last_processed_at,
        action_remainder: u.action_remainder,
      }
      : m;
  });

  return { state: { ...state, minerals, oil_balance: oilBalance, diamond_balance: diamondBalance, daily_diamond_count: dailyCount, daily_diamond_reset_at: new Date(resetAt).toISOString() }, machines: refreshedMachines };
}

export function getTankCapacity(config: GameConfig, type: string, level: number) {
  const base = config.machines[type]?.tank_capacity ?? 0;
  return getMultiplier(base, level, config.progression.level_capacity_multiplier);
}

export function getUpgradeCost(config: GameConfig, type: string, level: number) {
  const base = config.machines[type]?.cost_oil ?? 0;
  return Math.floor(base * Math.pow(2, level - 1));
}

// Helper to calculate total value for recycling (Base Cost + All Upgrades to current level)
export function getTotalInvestment(config: GameConfig, machine: MachineRow) {
  const machineConfig = config.machines[machine.type];
  if (!machineConfig) return 0;

  let total = machineConfig.cost_oil;
  // Sum upgrade costs for levels 1 -> current level
  // Note: Upgrading TO level 2 costs (base * 1 * mult). Upgrading TO level N costs (base * (N-1) * mult).
  for (let l = 1; l < machine.level; l++) {
    total += getUpgradeCost(config, machine.type, l);
  }
  return total;
}
