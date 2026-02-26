export interface Round {
    id: string;
    round_date: string;
    revenue_wld: number;
    payout_pool_wld: number;
    total_diamonds: number;
    status: string;
    created_at: string;
    payouts?: any[];
}

export interface AdminStats {
    open_rounds: Round[];
    execution_rounds: Round[];
    total_users?: number;
    total_oil?: number;
    total_diamonds?: number;
    daily_revenue_wld?: number;
    daily_revenue_wld_total?: number;
    daily_revenue_wld_machine?: number;
    daily_revenue_wld_slot?: number;
    reconciliation?: {
        outstanding_rounds: number;
        open_rounds_with_actionable_requests: number;
        closed_rounds_ready_to_paid: number;
        refunded_payouts?: number;
    };
}

export interface SeasonRewardTier {
    rank_from: number;
    rank_to: number;
    reward_wld: number;
    label: string;
}

export type SeasonStatus = 'draft' | 'active' | 'ended' | 'rewarded';

export interface Season {
    id: string;
    name: string;
    description?: string | null;
    status: SeasonStatus;
    start_time: string;
    end_time: string;
    is_active: boolean;
    reward_tiers: SeasonRewardTier[];
    created_by?: string | null;
    ended_at?: string | null;
    created_at: string;
    total_players?: number;
    total_diamonds?: number;
    reward_count?: number;
    machine_pool_total?: number;
    machine_pool_remaining?: number;
    revenue_wld?: number;
}

export interface SeasonReward {
    id: string;
    season_id: string;
    user_id: string;
    rank: number;
    diamonds_collected: number;
    reward_wld: number;
    reward_oil?: number;
    reward_diamonds?: number;
    status: 'pending' | 'paid' | 'failed';
    tx_hash?: string | null;
    created_at: string;
    paid_at?: string | null;
    player_name?: string;
}

export interface SeasonLeaderboardEntry {
    rank: number;
    user_id: string;
    player_name: string;
    wallet_address?: string | null;
    diamonds_collected: number;
    last_updated: string;
}
