import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { createSession, getAdminClient } from '../_shared/supabase.ts';
import { logSecurityEvent, extractClientInfo } from '../_shared/security.ts';
import { verifySiweMessage } from 'https://esm.sh/@worldcoin/minikit-js@1.9.6';
import { SiweMessage } from 'https://esm.sh/siwe@2.3.2';
import { verifyMessage, JsonRpcProvider, Contract, hashMessage } from 'https://esm.sh/ethers@6.11.1';

interface CompleteRequest {
  payload: {
    status: string;
    message: string;
    signature: string;
    address?: string;
  };
  nonce: string;
  player_name?: string;
  username?: string;
  referral_code?: string;
}

const DEFAULT_RPC_URL = 'https://worldchain-mainnet.g.alchemy.com/public';
const EIP1271_MAGIC_VALUE = '0x1626ba7e';
const EIP1271_ABI = ['function isValidSignature(bytes32 _hash, bytes _signature) view returns (bytes4)'];

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function messageVariants(raw: string): string[] {
  const trimmed = raw.trim();
  const lfNormalized = raw.replace(/\r\n/g, '\n');
  const lfTrimmed = lfNormalized.trim();
  return Array.from(new Set([raw, trimmed, lfNormalized, lfTrimmed]));
}

async function verifyEip1271Signature(walletAddress: string, message: string, signature: string): Promise<boolean> {
  try {
    const rpcUrl = Deno.env.get('JSON_RPC_URL') || DEFAULT_RPC_URL;
    const provider = new JsonRpcProvider(rpcUrl);
    const code = await provider.getCode(walletAddress);
    if (!code || code === '0x') {
      return false;
    }

    const contract = new Contract(walletAddress, EIP1271_ABI, provider);
    const digest = hashMessage(message);
    const result = await contract.isValidSignature(digest, signature);
    return String(result).toLowerCase() === EIP1271_MAGIC_VALUE;
  } catch (err) {
    console.warn('[AuthComplete] EIP-1271 verification failed:', (err as Error).message);
    return false;
  }
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { payload, nonce, player_name, username, referral_code } = (await req.json()) as CompleteRequest;
    if (!payload || !nonce) {
      throw new Error('Missing payload or nonce');
    }

    const admin = getAdminClient();
    const { data: nonceRow } = await admin
      .from('auth_nonces')
      .select('*')
      .eq('nonce', nonce)
      .single();

    if (!nonceRow) {
      throw new Error('Invalid nonce');
    }

    const expiresAt = new Date(nonceRow.expires_at).getTime();
    if (Date.now() > expiresAt) {
      throw new Error('Nonce expired');
    }

    const { message, signature, address: payloadAddress } = payload;

    if (!message || !signature) {
      throw new Error('Missing message or signature in payload');
    }

    console.log(`[AuthComplete] Received auth request for nonce: ${nonce}`);
    console.log(`[AuthComplete] Payload Address: ${payloadAddress}`);

    let walletAddress: string | undefined;

    // --- Primary path: use the official SDK's verifySiweMessage ---
    try {
      const verification = await verifySiweMessage(payload, nonce);
      if (verification.isValid) {
        walletAddress = payloadAddress;
        console.log(`[AuthComplete] SDK verifySiweMessage success for: ${walletAddress}`);
      } else {
        console.warn('[AuthComplete] SDK verifySiweMessage returned invalid');
      }
    } catch (sdkErr) {
      console.warn('[AuthComplete] SDK verifySiweMessage threw:', (sdkErr as Error).message);
    }

    // --- Fallback: manual SIWE + EOA + EIP-1271 verification ---
    if (!walletAddress) {
      try {
        const siweMessage = new SiweMessage(message);

        if (siweMessage.nonce !== nonce) {
          console.error(`[AuthComplete] Nonce mismatch. Expected: ${nonce}, Received: ${siweMessage.nonce}`);
          throw new Error('Nonce mismatch');
        }

        console.log(`[AuthComplete] SIWE address: ${siweMessage.address}`);

        try {
          const { success, data } = await siweMessage.verify({ signature, nonce });
          if (success) {
            walletAddress = data.address;
            console.log(`[AuthComplete] SIWE verify success: ${walletAddress}`);
          }
        } catch (e) {
          console.warn(`[AuthComplete] siweMessage.verify error:`, (e as Error).message);
        }

        if (!walletAddress) {
          const expectedSiweAddress = normalizeAddress(siweMessage.address);

          for (const candidate of messageVariants(message)) {
            try {
              const recoveredAddress = normalizeAddress(verifyMessage(candidate, signature));
              if (recoveredAddress === expectedSiweAddress) {
                walletAddress = siweMessage.address;
                break;
              }
            } catch {
              // continue next candidate
            }
          }

          if (!walletAddress) {
            for (const candidate of messageVariants(message)) {
              const ok1271 = await verifyEip1271Signature(siweMessage.address, candidate, signature);
              if (ok1271) {
                walletAddress = siweMessage.address;
                break;
              }
            }
          }
        }
      } catch (e) {
        console.warn(`[AuthComplete] SIWE fallback path failed:`, (e as Error).message);

        if (payloadAddress) {
          const expectedPayloadAddress = normalizeAddress(payloadAddress);

          for (const candidate of messageVariants(message)) {
            try {
              const recoveredAddress = normalizeAddress(verifyMessage(candidate, signature));
              if (recoveredAddress === expectedPayloadAddress) {
                walletAddress = payloadAddress;
                break;
              }
            } catch {
              // try next variant
            }
          }

          if (!walletAddress) {
            for (const candidate of messageVariants(message)) {
              const ok1271 = await verifyEip1271Signature(payloadAddress, candidate, signature);
              if (ok1271) {
                walletAddress = payloadAddress;
                break;
              }
            }
          }

          if (!walletAddress) {
            throw new Error('Signature/address mismatch');
          }

          if (!message.includes(nonce)) {
            throw new Error('Nonce mismatch');
          }
        } else {
          throw new Error('SIWE validation failed: ' + (e as Error).message);
        }
      }
    }

    if (!walletAddress) {
      throw new Error('Wallet address missing');
    }

    // Always normalize to lowercase for consistent DB lookups
    walletAddress = normalizeAddress(walletAddress);

    // Consume nonce only after successful verification.
    await admin.from('auth_nonces').delete().eq('nonce', nonce);

    // Case-insensitive profile lookup using the normalized (lowercased) address
    let { data: profile } = await admin
      .from('profiles')
      .select('id, player_name, is_admin, is_human_verified')
      .ilike('wallet_address', walletAddress)
      .single();

    let userId: string | null = profile?.id ?? null;

    if (!userId) {
      const email = `wallet_${walletAddress}@world.local`;
      const password = crypto.randomUUID() + crypto.randomUUID();

      let userIdFromAuth = '';

      const { data: authUser, error: authError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (authError) {
        // Use email filter instead of unfiltered listUsers to avoid pagination issues
        const { data: users } = await admin.auth.admin.listUsers({ filter: email, perPage: 1 });
        const existingUser = users?.users?.[0];
        if (existingUser) {
          userIdFromAuth = existingUser.id;
        } else {
          throw new Error('Failed to create auth user: ' + authError.message);
        }
      } else {
        userIdFromAuth = authUser.user.id;
      }

      userId = userIdFromAuth;

      const resolvedName = player_name || username || 'Miner';

      // Look up referrer by referral_code if provided
      let referrerId: string | null = null;
      if (referral_code) {
        const { data: referrer } = await admin
          .from('profiles')
          .select('id')
          .eq('referral_code', referral_code.toUpperCase())
          .single();
        if (referrer && referrer.id !== userId) {
          referrerId = referrer.id;
        }
      }

      const { data: createdProfile, error: profileError } = await admin
        .from('profiles')
        .upsert({
          id: userId,
          player_name: resolvedName,
          wallet_address: walletAddress,
          referred_by: referrerId,
        })
        .select('id, player_name, is_admin, is_human_verified')
        .single();

      if (profileError || !createdProfile) {
        throw new Error('Failed to create profile');
      }

      profile = createdProfile;
    } else if (player_name && profile?.player_name !== player_name) {
      await admin
        .from('profiles')
        .update({ player_name })
        .eq('id', userId);
    }

    if (!userId) throw new Error('User ID not resolved');

    const session = await createSession(userId);

    return new Response(
      JSON.stringify({
        session: {
          token: session.token,
          user_id: userId,
          player_name: player_name || profile?.player_name || 'Miner',
          is_admin: Boolean(profile?.is_admin),
          is_human_verified: Boolean(profile?.is_human_verified),
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('auth-complete error:', err);
    const clientInfo = extractClientInfo(req);
    logSecurityEvent({
      event_type: 'auth_failure',
      severity: 'warning',
      action: 'auth-complete',
      details: { error: (err as Error).message },
      ...clientInfo,
    });
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
