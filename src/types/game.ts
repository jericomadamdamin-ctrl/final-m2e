export type MineralType = 'bronze' | 'silver' | 'gold' | 'iron';
export type MachineType = string;
// export type MachineType = 'mini' | 'light' | 'heavy' | 'mega'; // Deprecated in favor of DB config

export interface Machine {
  id: string;
  type: MachineType;
  level: number;
  fuelOil: number;
  isActive: boolean;
  lastProcessedAt?: string | null;
}

export interface PlayerState {
  oilBalance: number;
  diamondBalance: number;
  minerals: Record<MineralType, number>;
  purchasedSlots?: number;
  maxSlots?: number;
  totalConvertedOil?: number;
  lastDailyClaim?: string;
  lastCashout?: string;
}

export interface GameConfig {
  pricing: {
    oil_per_wld: number;
    oil_per_usdc: number;
    usdc_to_wld_rate?: number;
    admin_editable: boolean;
  };
  machines: Record<MachineType, {
    cost_oil: number;
    cost_wld?: number;
    speed_actions_per_hour: number;
    oil_burn_per_hour: number;
    tank_capacity: number;
    max_level: number;
    name?: string;
    image_url?: string;
  }>;
  mining: {
    action_rewards: {
      minerals: Record<MineralType, { drop_rate: number; oil_value: number }>;
      diamond: { drop_rate_per_action: number };
    };
  };
  diamond_controls: {
    daily_cap_per_user: number;
    excess_diamond_oil_value: number;
  };
  progression: {
    level_speed_multiplier: number;
    level_oil_burn_multiplier: number;
    level_capacity_multiplier: number;
    upgrade_cost_multiplier: number;
  };
  cashout: {
    enabled: boolean;
    minimum_diamonds_required: number;
    cooldown_days: number;
    tax_rate_percent?: number;
    diamond_wld_exchange_rate?: number;
  };
  treasury: {
    payout_percentage: number;
    treasury_address?: string | null;
  };
  global_game_settings?: {
    daily_oil_reward: number;
  };
  referrals?: {
    bonus_diamonds: number;
  };
  player_messaging_rules: {
    no_fixed_roi_promises: boolean;
    diamonds_described_as: string;
    wld_described_as: string;
    payouts_depend_on_revenue: boolean;
  };
  slots?: {
    base_slots: number;
    slot_pack_size: number;
    slot_pack_price_wld: number;
    max_total_slots: number;
  };
}

export interface GameStateResponse {
  config: GameConfig;
  profile?: {
    player_name?: string | null;
    is_admin?: boolean;
    is_human_verified?: boolean;
    wallet_address?: string | null;
    referral_code?: string | null;
    referral_count?: number;
  };
  state: {
    oil_balance: number;
    diamond_balance: number;
    minerals: Record<MineralType, number>;
    purchased_slots?: number;
    max_slots?: number;
    last_daily_claim?: string;
    last_cashout?: string;
  };
  machines: Array<{
    id: string;
    type: MachineType;
    level: number;
    fuel_oil: number;
    is_active: boolean;
    last_processed_at?: string | null;
  }>;
}

export const MINERAL_LABELS: Record<MineralType, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  iron: 'Iron',
};
