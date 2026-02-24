import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { getAdminClient, requireUserId, requireAdminOrKey } from '../_shared/supabase.ts';

interface CashoutRequestBody {
  round_id: string;
  manual_pool_wld?: number;
  action?: 'recalculate' | 'process';
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = await requireUserId(req);
    await requireAdminOrKey(req, userId);

    const { round_id, manual_pool_wld, action } = await req.json() as CashoutRequestBody;
    if (!round_id) throw new Error('Missing round_id');
    const commandId = req.headers.get('x-request-id') || crypto.randomUUID();
    const normalizedAction = action || 'process';
    console.log(JSON.stringify({
      event: 'cashout_process_command',
      command_id: commandId,
      actor_id: userId,
      round_id,
      action: normalizedAction,
      manual_pool_wld: manual_pool_wld ?? null,
    }));

    const admin = getAdminClient();
    if (manual_pool_wld !== undefined && manual_pool_wld !== null) {
      if (typeof manual_pool_wld !== 'number' || !Number.isFinite(manual_pool_wld) || manual_pool_wld < 0) {
        throw new Error('manual_pool_wld must be a valid number >= 0');
      }
    }

    let rpcName = 'finalize_cashout_round';
    let rpcPayload: Record<string, unknown> = {
      p_round_id: round_id,
      p_manual_pool_wld: manual_pool_wld ?? null,
      p_actor_id: userId,
    };

    if (normalizedAction === 'recalculate') {
      if (typeof manual_pool_wld !== 'number' || !Number.isFinite(manual_pool_wld) || manual_pool_wld < 0) {
        throw new Error('Valid manual_pool_wld is required for recalculation');
      }
      rpcName = 'recalculate_cashout_round';
      rpcPayload = {
        p_round_id: round_id,
        p_manual_pool_wld: manual_pool_wld,
        p_actor_id: userId,
      };
    } else if (normalizedAction !== 'process') {
      throw new Error(`Unsupported action: ${normalizedAction}`);
    }

    const { data: rpcResult, error: rpcError } = await admin.rpc(rpcName, rpcPayload);
    if (rpcError) {
      throw new Error(`Cashout ${normalizedAction} failed: ${rpcError.message}`);
    }

    const result = rpcResult as Record<string, unknown> | null;
    if (!result || result.ok !== true) {
      throw new Error(String(result?.message || `Cashout ${normalizedAction} failed`));
    }

    return jsonResponse({
      ...(result as Record<string, unknown>),
      command_id: commandId,
    });

  } catch (err) {
    console.error('Cashout process error:', (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Helper
function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
