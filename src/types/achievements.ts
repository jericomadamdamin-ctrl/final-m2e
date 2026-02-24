import { MineralType } from './game';

export type AchievementId = 
  | 'first_machine'
  | 'buy_5_machines'
  | 'buy_10_machines'
  | 'first_upgrade'
  | 'max_level_machine'
  | 'upgrade_10_times'
  | 'collect_100_bronze'
  | 'collect_100_silver'
  | 'collect_50_gold'
  | 'collect_50_iron'
  | 'find_diamond'
  | 'collect_10_diamonds'
  | 'earn_10000_oil'
  | 'exchange_minerals'
  | 'daily_claimer';

export interface AchievementReward {
  oil?: number;
  minerals?: Partial<Record<MineralType, number>>;
}

export interface Achievement {
  id: AchievementId;
  name: string;
  description: string;
  icon: string;
  reward: AchievementReward;
  requirement: number;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first_machine',
    name: 'First Steps',
    description: 'Buy your first mining machine',
    icon: '⛏️',
    reward: { oil: 100 },
    requirement: 1,
  },
  {
    id: 'buy_5_machines',
    name: 'Growing Fleet',
    description: 'Own 5 mining machines',
    icon: '🏭',
    reward: { oil: 500, minerals: { bronze: 10 } },
    requirement: 5,
  },
  {
    id: 'buy_10_machines',
    name: 'Mining Mogul',
    description: 'Own 10 mining machines',
    icon: '👑',
    reward: { oil: 2000, minerals: { silver: 20 } },
    requirement: 10,
  },
  {
    id: 'first_upgrade',
    name: 'Upgrader',
    description: 'Upgrade a machine for the first time',
    icon: '⬆️',
    reward: { oil: 150 },
    requirement: 1,
  },
  {
    id: 'max_level_machine',
    name: 'Maxed Out',
    description: 'Upgrade a machine to max level (10)',
    icon: '🌟',
    reward: { oil: 5000, minerals: { gold: 10 } },
    requirement: 1,
  },
  {
    id: 'upgrade_10_times',
    name: 'Dedicated Upgrader',
    description: 'Perform 10 total upgrades',
    icon: '🔧',
    reward: { oil: 1000, minerals: { iron: 15 } },
    requirement: 10,
  },
  {
    id: 'collect_100_bronze',
    name: 'Bronze Collector',
    description: 'Collect 100 bronze minerals',
    icon: '🥉',
    reward: { oil: 200 },
    requirement: 100,
  },
  {
    id: 'collect_100_silver',
    name: 'Silver Hunter',
    description: 'Collect 100 silver minerals',
    icon: '🥈',
    reward: { oil: 400 },
    requirement: 100,
  },
  {
    id: 'collect_50_gold',
    name: 'Gold Digger',
    description: 'Collect 50 gold minerals',
    icon: '🥇',
    reward: { oil: 800, minerals: { gold: 5 } },
    requirement: 50,
  },
  {
    id: 'collect_50_iron',
    name: 'Iron Miner',
    description: 'Collect 50 iron minerals',
    icon: '🔩',
    reward: { oil: 600, minerals: { iron: 5 } },
    requirement: 50,
  },
  {
    id: 'find_diamond',
    name: 'Lucky Strike',
    description: 'Find your first diamond',
    icon: '💎',
    reward: { oil: 1000 },
    requirement: 1,
  },
  {
    id: 'collect_10_diamonds',
    name: 'Diamond Hands',
    description: 'Collect 10 diamonds total',
    icon: '💍',
    reward: { oil: 5000, minerals: { diamond: 1 } },
    requirement: 10,
  },
  {
    id: 'earn_10000_oil',
    name: 'Oil Baron',
    description: 'Earn 10,000 oil from mineral exchanges',
    icon: '🛢️',
    reward: { oil: 2000 },
    requirement: 10000,
  },
  {
    id: 'exchange_minerals',
    name: 'Market Trader',
    description: 'Complete 20 mineral exchanges',
    icon: '📈',
    reward: { oil: 500, minerals: { silver: 10 } },
    requirement: 20,
  },
  {
    id: 'daily_claimer',
    name: 'Consistent Miner',
    description: 'Claim daily reward 7 times',
    icon: '📅',
    reward: { oil: 1000, minerals: { bronze: 20, silver: 10 } },
    requirement: 7,
  },
];
