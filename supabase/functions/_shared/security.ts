import { getAdminClient } from './supabase.ts';

type SecurityEventType =
    | 'auth_failure'
    | 'auth_success'
    | 'session_expired'
    | 'session_invalid'
    | 'rate_limit_exceeded'
    | 'suspicious_activity'
    | 'validation_failed'
    | 'cashout_request'
    | 'cashout_executed'
    | 'purchase_initiated'
    | 'purchase_confirmed'
    | 'purchase_failed'
    | 'game_action'
    | 'machine_discarded'
    | 'admin_action'
    | 'anomaly_detected';

type Severity = 'info' | 'warning' | 'error' | 'critical';

interface SecurityEventData {
    event_type: SecurityEventType;
    user_id?: string;
    severity?: Severity;
    action?: string;
    details?: Record<string, unknown>;
    ip_address?: string;
    user_agent?: string;
}

/**
 * Log a security event to the database
 * Non-blocking - failures are silently ignored to not disrupt main flow
 */
export async function logSecurityEvent(data: SecurityEventData): Promise<void> {
    try {
        const admin = getAdminClient();
        await admin.from('security_events').insert({
            event_type: data.event_type,
            user_id: data.user_id || null,
            severity: data.severity || 'info',
            action: data.action || null,
            details: data.details || {},
            ip_address: data.ip_address || null,
            user_agent: data.user_agent || null,
        });
    } catch {
        // Silent fail - security logging should never break main flow
        console.error('[SecurityLogger] Failed to log event:', data.event_type);
    }
}

/**
 * Extract client info from request for logging
 */
export function extractClientInfo(req: Request): { ip_address?: string; user_agent?: string } {
    return {
        ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
            || req.headers.get('x-real-ip')
            || undefined,
        user_agent: req.headers.get('user-agent') || undefined,
    };
}

/**
 * Check if a feature flag is enabled
 */
export async function isFeatureEnabled(key: string): Promise<boolean> {
    try {
        const admin = getAdminClient();
        const { data } = await admin
            .from('feature_flags')
            .select('enabled')
            .eq('key', key)
            .single();
        return data?.enabled ?? true; // Default to enabled if not found
    } catch {
        return true; // Default to enabled on error
    }
}

/**
 * Rate limit check - returns true if under limit
 */
export async function checkRateLimit(
    userId: string,
    action: string,
    maxRequests: number = 10,
    windowMinutes: number = 1
): Promise<{ allowed: boolean; remaining: number }> {
    try {
        const admin = getAdminClient();
        const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

        const { data } = await admin
            .from('rate_limits')
            .select('request_count')
            .eq('user_id', userId)
            .eq('action', action)
            .gte('window_start', windowStart);

        const totalRequests = (data || []).reduce((sum: number, r: { request_count: number }) => sum + r.request_count, 0);

        if (totalRequests >= maxRequests) {
            return { allowed: false, remaining: 0 };
        }

        // Record this request in the current-minute bucket.
        const currentMinute = new Date();
        currentMinute.setSeconds(0, 0);
        const bucket = currentMinute.toISOString();

        const { data: existingBucket } = await admin
            .from('rate_limits')
            .select('id, request_count')
            .eq('user_id', userId)
            .eq('action', action)
            .eq('window_start', bucket)
            .maybeSingle();

        if (existingBucket?.id) {
            await admin
                .from('rate_limits')
                .update({ request_count: Number(existingBucket.request_count || 0) + 1 })
                .eq('id', existingBucket.id);
        } else {
            await admin.from('rate_limits').insert({
                user_id: userId,
                action,
                window_start: bucket,
                request_count: 1,
            });
        }

        return { allowed: true, remaining: maxRequests - totalRequests - 1 };
    } catch (err) {
        // On error, allow the request but log it
        console.error('[RateLimit] Error:', err);
        return { allowed: true, remaining: 0 };
    }
}


/**
 * Validate numeric range
 */
export function validateRange(
    value: number,
    min: number,
    max: number,
    name: string
): void {
    if (!Number.isFinite(value) || value < min || value > max) {
        throw new Error(`Invalid ${name}: must be between ${min} and ${max}`);
    }
}

/**
 * Sanity check for suspicious values
 */
export function isSuspiciousValue(value: number, expectedMax: number): boolean {
    return value > expectedMax * 10 || value < 0 || !Number.isFinite(value);
}

/**
 * Check idempotency key - returns cached response if exists
 */
export async function checkIdempotencyKey(
    key: string,
    userId: string,
    action: string
): Promise<{ exists: boolean; response?: unknown }> {
    try {
        const admin = getAdminClient();
        const { data } = await admin
            .from('idempotency_keys')
            .select('response')
            .eq('key', key)
            .eq('user_id', userId)
            .single();

        if (data) {
            return { exists: true, response: data.response };
        }
        return { exists: false };
    } catch {
        return { exists: false };
    }
}

/**
 * Store idempotency key with response
 */
export async function storeIdempotencyKey(
    key: string,
    userId: string,
    action: string,
    response: unknown
): Promise<void> {
    try {
        const admin = getAdminClient();
        await admin.from('idempotency_keys').insert({
            key,
            user_id: userId,
            action,
            response,
        });
    } catch {
        // Silent fail
    }
}

/**
 * Check if user is shadow banned
 */
export async function isPlayerShadowBanned(userId: string): Promise<boolean> {
    try {
        const admin = getAdminClient();
        const { data } = await admin
            .from('player_flags')
            .select('is_shadow_banned')
            .eq('user_id', userId)
            .single();
        return data?.is_shadow_banned ?? false;
    } catch {
        return false;
    }
}

/**
 * Log suspicious activity
 */
export async function logSuspiciousActivity(
    userId: string,
    activityType: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    details: Record<string, unknown>,
    ipAddress?: string
): Promise<void> {
    try {
        const admin = getAdminClient();
        await admin.from('suspicious_activity').insert({
            user_id: userId,
            activity_type: activityType,
            severity,
            details,
            ip_address: ipAddress,
        });

        // Also log as security event
        await logSecurityEvent({
            event_type: 'suspicious_activity',
            user_id: userId,
            severity: severity === 'critical' ? 'critical' : severity === 'high' ? 'error' : 'warning',
            action: activityType,
            details,
            ip_address: ipAddress,
        });
    } catch {
        console.error('[Security] Failed to log suspicious activity');
    }
}

/**
 * Update player statistics (for anomaly detection)
 */
export async function updatePlayerStats(
    userId: string,
    stats: {
        actionCount?: number;
        oilEarned?: number;
        oilSpent?: number;
        diamondsEarned?: number;
    }
): Promise<void> {
    try {
        const admin = getAdminClient();
        await admin.rpc('update_player_stats', {
            p_user_id: userId,
            p_action_count: stats.actionCount ?? 0,
            p_oil_earned: stats.oilEarned ?? 0,
            p_oil_spent: stats.oilSpent ?? 0,
            p_diamonds_earned: stats.diamondsEarned ?? 0,
        });
    } catch {
        // Silent fail
    }
}
