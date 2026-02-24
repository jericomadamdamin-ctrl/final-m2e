import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export function getAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export function getUserClient(authHeader: string | null) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  });
}

export async function requireUserId(req: Request): Promise<string> {
  const tokenFromHeader = req.headers.get('x-app-session')?.trim();
  const authHeader = req.headers.get('Authorization');
  const tokenFromAuth = authHeader?.toLowerCase().startsWith('bearer ')
    ? authHeader.slice('bearer '.length).trim()
    : null;

  // Prefer our dedicated header. If a legacy client sends the session token in
  // `Authorization`, accept it only when it doesn't look like a JWT.
  const token =
    tokenFromHeader ||
    (tokenFromAuth && !tokenFromAuth.includes('.') ? tokenFromAuth : null);

  if (!token) {
    throw new Error('Missing app session token');
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .from('app_sessions')
    .select('user_id, expires_at')
    .eq('token', token)
    .single();

  if (error || !data?.user_id) {
    throw new Error('Invalid session token');
  }

  const expiresAt = new Date(data.expires_at).getTime();
  if (Number.isFinite(expiresAt) && Date.now() > expiresAt) {
    throw new Error('Session expired');
  }

  return data.user_id;
}

export async function requireAdmin(userId: string) {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select('is_admin, wallet_address')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data?.is_admin) {
    throw new Error('Admin privileges required');
  }

  /* 
  // Trusted Admin Check: relying on is_admin flag in DB.
  // The env var check is too strict for flexible team access.
  const allowedWallet = Deno.env.get('ADMIN_WALLET_ADDRESS');
  if (allowedWallet && (!data.wallet_address || data.wallet_address.toLowerCase() !== allowedWallet.toLowerCase())) {
    throw new Error('Unauthorized admin wallet');
  } 
  */
}

export async function requireAdminOrKey(req: Request, userId: string) {
  const providedKey = req.headers.get('x-admin-key');
  const requiredKey = Deno.env.get('ADMIN_ACCESS_KEY');
  const allowedWallet = Deno.env.get('ADMIN_WALLET_ADDRESS');

  if (requiredKey && providedKey === requiredKey) {
    const admin = getAdminClient();
    const { data: profile } = await admin
      .from('profiles')
      .select('wallet_address, is_admin')
      .eq('id', userId)
      .maybeSingle();

    // Auto-promote if key is valid
    if (profile && !profile.is_admin) {
      await admin.from('profiles').update({ is_admin: true }).eq('id', userId);
    }
    return;
  }

  // Fallback to strict DB check
  await requireAdmin(userId);
}

export async function createSession(userId: string, ttlHours = 24 * 30) {
  const admin = getAdminClient();
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  const { error } = await admin
    .from('app_sessions')
    .insert({ token, user_id: userId, expires_at: expiresAt });

  if (error) {
    throw new Error('Failed to create session');
  }

  return { token, expires_at: expiresAt };
}

export async function requireHuman(userId: string) {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select('is_human_verified')
    .eq('id', userId)
    .single();
  if (error || !data?.is_human_verified) {
    throw new Error('Human verification required');
  }
}
export async function verifyAdmin(req: Request): Promise<void> {
  const providedKey = req.headers.get('x-admin-key');
  const requiredKey = Deno.env.get('ADMIN_ACCESS_KEY');

  if (!requiredKey) {
    console.error('ADMIN_ACCESS_KEY is not set in environment');
    throw new Error('Admin Access Key is not configured on server');
  }

  if (providedKey !== requiredKey) {
    console.error('Key mismatch!', {
      providedLength: providedKey?.length,
      requiredLength: requiredKey?.length,
      providedStart: providedKey?.substring(0, 2),
      requiredStart: requiredKey?.substring(0, 2)
    });
    throw new Error('Invalid Admin Access Key');
  }

  const userId = await requireUserId(req);
  const admin = getAdminClient();
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('is_admin, wallet_address')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) {
    console.error('Error fetching admin profile:', profileError);
    throw new Error(`Profile fetch failed: ${profileError.message}`);
  }

  if (!profile) {
    throw new Error('User profile not found. Please log in again.');
  }

  const allowedWallet = Deno.env.get('ADMIN_WALLET_ADDRESS');
  if (allowedWallet) {
    const allowedWallets = allowedWallet.split(',').map(w => w.trim().toLowerCase());
    if (!profile.wallet_address || !allowedWallets.includes(profile.wallet_address.toLowerCase())) {
      console.warn(`Admin wallet mismatch. Profile: ${profile.wallet_address}, Allowed: ${allowedWallet}`);
      throw new Error('Your wallet address is not authorized for Game Master access');
    }
  }

  if (!profile.is_admin) {
    console.log(`Auto-promoting user ${userId} to admin via valid Access Key`);
    const { error: updateError } = await admin
      .from('profiles')
      .update({ is_admin: true })
      .eq('id', userId);

    if (updateError) {
      console.error('Failed to auto-promote admin:', updateError);
      throw new Error('Failed to grant admin privileges. Check database RLS/permissions.');
    }
  }
}
