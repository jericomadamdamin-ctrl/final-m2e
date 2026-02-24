import { supabase } from '@/integrations/supabase/client';
import { GameStateResponse, Machine } from '@/types/game';
import { getSessionToken } from '@/lib/session';

export const authHeaders = () => {
  const token = getSessionToken();
  // Do not override `Authorization` because Supabase Edge Functions may require a valid
  // Supabase JWT there. We send our app session token in a separate header.
  return token ? { 'x-app-session': token } : {};
};

function isEdgeErrorPayload(data: unknown): data is { error: string } {
  if (!data || typeof data !== 'object') return false;
  if (!('error' in data)) return false;
  return typeof (data as { error?: unknown }).error === 'string';
}

export async function fetchGameState(): Promise<GameStateResponse> {
  const { data, error } = await supabase.functions.invoke('game-state', {
    headers: authHeaders(),
  });
  if (error) await handleFunctionError(error);
  if (isEdgeErrorPayload(data)) {
    throw new Error(data.error);
  }
  return data as GameStateResponse;
}

export async function gameAction(action: string, payload?: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('game-action', {
    headers: authHeaders(),
    body: { action, payload },
  });
  if (error) await handleFunctionError(error);
  if (isEdgeErrorPayload(data)) {
    throw new Error(data.error);
  }
  // biome-ignore lint/suspicious/noExplicitAny: Backend response type
  return data as { state: GameStateResponse['state']; machines: GameStateResponse['machines'] };
}

export async function fetchConfig() {
  const { data, error } = await supabase.functions.invoke('config-get', {
    headers: authHeaders(),
  });
  if (error) await handleFunctionError(error);
  if (isEdgeErrorPayload(data)) {
    throw new Error(data.error);
  }
  // biome-ignore lint/suspicious/noExplicitAny: Backend response type
  return data as { config: GameStateResponse['config'] };
}

export async function updateConfig(updates: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('config-set', {
    headers: authHeaders(),
    body: { updates },
  });
  if (error) await handleFunctionError(error);
  if (isEdgeErrorPayload(data)) {
    throw new Error(data.error);
  }
  // biome-ignore lint/suspicious/noExplicitAny: Backend response type
  return data as { config: GameStateResponse['config'] };
}

export async function requestCashout(diamonds: number) {
  const { data, error } = await supabase.functions.invoke('cashout-request', {
    headers: authHeaders(),
    body: { diamonds },
  });
  if (error) await handleFunctionError(error);
  if (isEdgeErrorPayload(data)) {
    throw new Error(data.error);
  }
  return data as {
    ok: boolean;
    request?: { id: string; status: string };
    round?: { id: string; status: string };
    settlement?: {
      finalized?: boolean;
      executed?: boolean;
      refunded?: boolean;
      message?: string;
    };
  };
}

export async function getAuthNonce() {
  const { data, error } = await supabase.functions.invoke('auth-nonce');
  if (error) await handleFunctionError(error);
  return data as { nonce: string };
}

// Helper to extract error message from Edge Function response
async function handleFunctionError(error: unknown): Promise<never> {
  let message = 'Request to edge function failed';

  if (error && typeof error === 'object') {
    // Check if there's a context Response we can parse
    const maybeErr = error as { context?: unknown; message?: unknown };
    if (maybeErr.context instanceof Response) {
      try {
        const ctx: Response = maybeErr.context;
        const json = await ctx.clone().json().catch(() => null);
        if (isEdgeErrorPayload(json)) {
          message = json.error;
        } else {
          const text = await ctx.clone().text().catch(() => '');
          if (text) {
            message = text;
          }
        }
      } catch {
        // ignore parse errors
      }
    } else if (typeof maybeErr.message === 'string') {
      message = maybeErr.message;
    }
  } else if (typeof error === 'string') {
    message = error;
  }

  throw new Error(message);
}

export async function completeWalletAuth(payload: unknown, nonce: string, playerName?: string, username?: string, referralCode?: string) {
  const { data, error } = await supabase.functions.invoke('auth-complete', {
    body: { payload, nonce, player_name: playerName, username, referral_code: referralCode },
  });
  if (error) await handleFunctionError(error);
  return data as {
    session: {
      token: string;
      user_id: string;
      player_name?: string;
      is_admin?: boolean;
      is_human_verified?: boolean;
    };
  };
}

export async function initiateOilPurchase(token: 'WLD' | 'USDC', oilAmount: number) {
  const { data, error } = await supabase.functions.invoke('oil-purchase-initiate', {
    headers: authHeaders(),
    body: { token, oil_amount: oilAmount },
  });
  if (error) await handleFunctionError(error);
  return data as {
    reference: string;
    token: 'WLD' | 'USDC';
    amount_token: number;
    amount_oil: number;
    to_address: string;
    description: string;
  };
}

export async function confirmOilPurchase(payload: unknown) {
  const { data, error } = await supabase.functions.invoke('oil-purchase-confirm', {
    headers: authHeaders(),
    body: { payload },
  });
  if (error) await handleFunctionError(error);
  return data as { status: string; oil_balance?: number };
}

export async function updateProfile(updates: { playerName?: string }) {
  const { data, error } = await supabase.functions.invoke('profile-update', {
    headers: authHeaders(),
    body: { player_name: updates.playerName },
  });
  if (error) await handleFunctionError(error);
  return data as { ok: boolean };
}

export async function initiateSlotPurchase() {
  const { data, error } = await supabase.functions.invoke('slot-purchase-initiate', {
    headers: authHeaders(),
    body: {},
  });
  if (error) await handleFunctionError(error);
  return data as {
    reference: string;
    slots_to_add: number;
    amount_wld: number;
    to_address: string;
    description: string;
    current_slots: number;
    new_max_slots: number;
  };
}

export async function confirmSlotPurchase(payload: unknown) {
  const { data, error } = await supabase.functions.invoke('slot-purchase-confirm', {
    headers: authHeaders(),
    body: { payload },
  });
  if (error) await handleFunctionError(error);
  return data as { ok: boolean; slots_added: number };
}

export async function initiateMachinePurchase(machineType: string) {
  const { data, error } = await supabase.functions.invoke('machine-purchase-initiate', {
    headers: authHeaders(),
    body: { machineType },
  });
  if (error) await handleFunctionError(error);
  return data as {
    reference: string;
    machine_type: string;
    amount_wld: number;
    to_address: string;
    description: string;
  };
}

export async function confirmMachinePurchase(payload: unknown) {
  const { data, error } = await supabase.functions.invoke('machine-purchase-confirm', {
    headers: authHeaders(),
    body: { payload }, // Wrapper property 'payload' as expected by backend
  });
  if (error) await handleFunctionError(error);
  // biome-ignore lint/suspicious/noExplicitAny: Machine type
  return data as { ok: boolean; machine: Machine; message: string };
}

export async function fetchAdminStats(accessKey?: string) {
  const headers = authHeaders();
  if (accessKey) headers['x-admin-key'] = accessKey;

  const { data, error } = await supabase.functions.invoke('admin-stats', {
    method: 'GET',
    headers,
  });
  if (error) await handleFunctionError(error);
  // biome-ignore lint/suspicious/noExplicitAny: Admin stats type
  // biome-ignore lint/suspicious/noExplicitAny: Admin stats type
  return data as import('@/types/admin').AdminStats;
}

export async function processCashoutRound(roundId: string, accessKey?: string, manualPoolWld?: number) {
  const headers = authHeaders();
  if (accessKey) headers['x-admin-key'] = accessKey;

  const { data, error } = await supabase.functions.invoke('cashout-process', {
    headers,
    body: { round_id: roundId, manual_pool_wld: manualPoolWld },
  });
  if (error) await handleFunctionError(error);
  return data as { ok: boolean; total_diamonds: number; payout_pool: number };
}

export async function recalculateCashoutRound(roundId: string, manualPoolWld: number, accessKey?: string) {
  const headers = authHeaders();
  if (accessKey) headers['x-admin-key'] = accessKey;

  const { data, error } = await supabase.functions.invoke('cashout-process', {
    headers,
    body: { round_id: roundId, manual_pool_wld: manualPoolWld, action: 'recalculate' },
  });
  if (error) await handleFunctionError(error);
  return data as { ok: boolean; total_diamonds: number; payout_pool: number };
}

export async function executeCashoutPayouts(
  roundId: string,
  accessKey?: string,
  options?: { retryFailed?: boolean; batchSize?: number }
) {
  const headers = authHeaders() as Record<string, string>;
  if (accessKey) headers['x-admin-key'] = accessKey;

  const { data, error } = await supabase.functions.invoke('cashout-execute', {
    headers,
    body: {
      round_id: roundId,
      retry_failed: options?.retryFailed ?? false,
      batch_size: options?.batchSize ?? 25,
    },
  });
  if (error) await handleFunctionError(error);
  // biome-ignore lint/suspicious/noExplicitAny: Payout results
  return data as { ok: boolean; results: unknown[] };
}

export async function reconcileCashout(accessKey?: string, options?: { roundId?: string; autoHeal?: boolean }) {
  const headers = authHeaders() as Record<string, string>;
  if (accessKey) headers['x-admin-key'] = accessKey;

  const { data, error } = await supabase.functions.invoke('cashout-reconcile', {
    headers,
    body: {
      round_id: options?.roundId,
      auto_heal: options?.autoHeal ?? false,
    },
  });
  if (error) await handleFunctionError(error);
  return data as {
    ok: boolean;
    command_id: string;
    summary: {
      open_with_requests_no_payouts: number;
      closed_ready_to_paid: number;
      diamond_mismatches: number;
      refund_mismatches?: number;
    };
  };
}

export async function fetchTable(table: string, accessKey?: string) {
  const headers = authHeaders();
  if (accessKey) headers['x-admin-key'] = accessKey;

  const { data, error } = await supabase.functions.invoke('admin-db', {
    headers,
    body: { table, action: 'fetch' },
  });
  if (error) await handleFunctionError(error);
  return data;
}

export async function updateTableRow(table: string, id: string, updates: Record<string, unknown>, accessKey?: string) {
  const headers = authHeaders();
  if (accessKey) headers['x-admin-key'] = accessKey;

  const { data, error } = await supabase.functions.invoke('admin-db', {
    headers,
    body: { table, action: 'update', id, updates },
  });
  if (error) await handleFunctionError(error);
  return data;
}

export async function updateGlobalSetting(key: string, value: number, accessKey?: string) {
  const headers = authHeaders();
  if (accessKey) headers['x-admin-key'] = accessKey;

  const { data, error } = await supabase.functions.invoke('admin-db', {
    headers,
    body: { table: 'global_game_settings', action: 'update', id: key, updates: { value } },
  });
  if (error) await handleFunctionError(error);
  return data;
}

export async function fetchPendingTransactions(accessKey: string) {
  const headers = authHeaders();
  if (accessKey) headers['x-admin-key'] = accessKey;

  const { data, error } = await supabase.functions.invoke('admin-payment', {
    headers,
    body: { action: 'fetch_pending' },
  });
  if (error) await handleFunctionError(error);
  return data as { oil: unknown[]; machines: unknown[]; slots?: unknown[] };
}

export async function verifyTransaction(type: 'oil' | 'machine' | 'slot', id: string, accessKey: string) {
  const headers = authHeaders();
  if (accessKey) headers['x-admin-key'] = accessKey;

  const { data, error } = await supabase.functions.invoke('admin-payment', {
    headers,
    body: { action: 'verify', type, id },
  });
  if (error) await handleFunctionError(error);
  return data;
}

export async function verifyAllPendingTransactions(accessKey: string) {
  const headers = authHeaders();
  if (accessKey) headers['x-admin-key'] = accessKey;

  const { data, error } = await supabase.functions.invoke('admin-payment-verify', {
    headers,
    body: { action: 'verify_all' },
  });
  if (error) await handleFunctionError(error);
  return data as {
    ok: boolean;
    summary: { total: number; confirmed: number; credited: number; skipped: number; failed: number };
    results: Array<{ id: string; type: string; status: string; credited: boolean; detail?: string }>;
  };
}

export async function verifySingleTransaction(type: 'oil' | 'machine' | 'slot', id: string, transactionId: string, accessKey: string) {
  const headers = authHeaders();
  if (accessKey) headers['x-admin-key'] = accessKey;

  const { data, error } = await supabase.functions.invoke('admin-payment-verify', {
    headers,
    body: { action: 'verify_one', type, id, transaction_id: transactionId },
  });
  if (error) await handleFunctionError(error);
  return data as {
    ok: boolean;
    result: { id: string; type: string; status: string; credited: boolean; detail?: string };
  };
}

export async function rejectTransaction(type: 'oil' | 'machine' | 'slot', id: string, accessKey: string) {
  const headers = authHeaders();
  if (accessKey) headers['x-admin-key'] = accessKey;

  const { data, error } = await supabase.functions.invoke('admin-payment', {
    headers,
    body: { action: 'reject', type, id },
  });
  if (error) await handleFunctionError(error);
  return data;
}

export async function fetchUsers(accessKey: string) {
  const headers = authHeaders();
  if (accessKey) headers['x-admin-key'] = accessKey;

  // We can reuse admin-db fetch for profiles, but let's join with player_state if possible, 
  // or just fetch profiles and we can fetch state separately or in a loop.
  // For now simple fetch of profiles is enough, we can add a specific join function later if needed.
  // But wait, admin-db fetch is simple select *.
  // Let's use it.

  // Actually, let's just use admin-db to fetch profiles.
  const profiles = await fetchTable('profiles', accessKey);
  return profiles;
}

export async function fetchPlayerState(userId: string, accessKey: string) {
  const headers = authHeaders();
  if (accessKey) headers['x-admin-key'] = accessKey;

  // We can't use generic fetchTable for single row easily without modification.
  // Let's modify admin-db to allow fetching by ID?
  // Actually, let's just fetch all player_state for now (not efficient but works for MVP) or add filtering to admin-db.
  // Given the constraints and existing tools, let's blindly fetch all states for now or just rely on what we have.
  // BETTER: The AdminUsers component can just fetch all 'player_state' and 'profiles' and join them client side for now, 
  // assuming user count is low. 
  return fetchTable('player_state', accessKey);
}

export async function fetchGlobalGameSettings(accessKey: string) {
  try {
    const { data, error } = await supabase.functions.invoke('global-settings-fetch', {
      body: { accessKey }
    });
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error fetching global settings:', err);
    return {
      diamond_wld_exchange_rate: 0.1 // Default fallback
    };
  }
}

/**
 * Get treasury wallet WLD balance from game config
 * Returns a simulated balance check - in production, integrate with actual blockchain query
 */
export async function checkTreasuryBalance(requiredAmount: number): Promise<{ sufficient: boolean; balance: number }> {
  try {
    // For now, we'll return a warning if the required amount is very high
    // In production, you would query the actual wallet balance via World App API or blockchain

    // Placeholder: assume treasury has 10000 WLD for now
    // TODO: Integrate with actual wallet balance check
    const mockBalance = 10000;

    return {
      sufficient: mockBalance >= requiredAmount,
      balance: mockBalance
    };
  } catch (error) {
    console.error('Error checking treasury balance:', error);
    return {
      sufficient: false,
      balance: 0
    };
  }
}

// ── Season Admin API ──

async function seasonAdmin(accessKey: string, action: string, body?: Record<string, unknown>) {
  const headers = authHeaders();
  if (accessKey) headers['x-admin-key'] = accessKey;

  const { data, error } = await supabase.functions.invoke('season-admin', {
    headers,
    body: { action, ...body },
  });
  if (error) await handleFunctionError(error);
  if (isEdgeErrorPayload(data)) throw new Error(data.error);
  return data;
}

export async function seasonAdminList(accessKey: string) {
  return seasonAdmin(accessKey, 'list') as Promise<{
    ok: boolean;
    seasons: import('@/types/admin').Season[];
  }>;
}

export async function seasonAdminCreate(
  accessKey: string,
  params: { name: string; description?: string; duration_hours: number; reward_tiers?: import('@/types/admin').SeasonRewardTier[] },
) {
  return seasonAdmin(accessKey, 'create', params) as Promise<{
    ok: boolean;
    season: import('@/types/admin').Season;
  }>;
}

export async function seasonAdminActivate(accessKey: string, seasonId: string) {
  return seasonAdmin(accessKey, 'activate', { season_id: seasonId }) as Promise<{
    ok: boolean;
    season: import('@/types/admin').Season;
  }>;
}

export async function seasonAdminEnd(accessKey: string, seasonId: string) {
  return seasonAdmin(accessKey, 'end', { season_id: seasonId }) as Promise<{
    ok: boolean;
    season: import('@/types/admin').Season;
  }>;
}

export async function seasonAdminDistribute(accessKey: string, seasonId: string) {
  return seasonAdmin(accessKey, 'distribute', { season_id: seasonId }) as Promise<{
    ok: boolean;
    rewards_created: number;
    rewards: import('@/types/admin').SeasonReward[];
  }>;
}

export async function seasonAdminLeaderboard(accessKey: string, seasonId: string) {
  return seasonAdmin(accessKey, 'leaderboard', { season_id: seasonId }) as Promise<{
    ok: boolean;
    entries: import('@/types/admin').SeasonLeaderboardEntry[];
    rewards: import('@/types/admin').SeasonReward[];
  }>;
}

export async function seasonAdminUpdate(
  accessKey: string,
  seasonId: string,
  params: { name?: string; description?: string; reward_tiers?: import('@/types/admin').SeasonRewardTier[]; duration_hours?: number },
) {
  return seasonAdmin(accessKey, 'update', { season_id: seasonId, ...params }) as Promise<{
    ok: boolean;
    season: import('@/types/admin').Season;
  }>;
}
