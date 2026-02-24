import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Shield, Loader2 } from 'lucide-react';
import { MiniKit, VerificationLevel, type ISuccessResult } from '@worldcoin/minikit-js';
import { supabase } from '@/integrations/supabase/client';
import { getSession, getSessionToken } from '@/lib/session';
import { ensureMiniKit, getMiniKitErrorMessage } from '@/lib/minikit';

interface HumanGateProps {
  onVerified: () => void;
}

export const HumanGate = ({ onVerified }: HumanGateProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleVerify = async () => {
    setLoading(true);
    try {
      const miniKit = ensureMiniKit();
      if (miniKit.ok === false) {
        toast({
          title: 'World App required',
          description: getMiniKitErrorMessage(miniKit.reason),
          variant: 'destructive',
        });
        setLoading(false);
        return;
      }

      const action =
        import.meta.env.VITE_WORLD_ID_ACTION_VERIFY ||
        import.meta.env.NEXT_PUBLIC_ACTION_VERIFY ||
        'verify-human';

      const session = getSession();
      const signal = session?.userId;

      const requestedLevel = import.meta.env.VITE_WORLD_ID_LEVEL?.toLowerCase();
      const verificationLevel =
        requestedLevel === 'orb'
          ? VerificationLevel.Orb
          : requestedLevel === 'device'
            ? VerificationLevel.Device
            : undefined;

      const { finalPayload } = await MiniKit.commandsAsync.verify({
        action,
        signal,
        ...(verificationLevel ? { verification_level: verificationLevel } : {}),
      });

      if (finalPayload.status !== 'success') {
        throw new Error('Verification cancelled');
      }

      const { error } = await supabase.functions.invoke('worldid-verify', {
        headers: { 'x-app-session': getSessionToken() ?? '' },
        body: { payload: finalPayload as ISuccessResult, action, signal },
      });

      if (error) {
        console.error('World ID Verification Error:', error);
        // Try to interpret the error message from the function response
        let errorMessage = 'Verification failed on server.';

        // If it's a standard Error object or similar structure with context
        if (error instanceof Error) {
          errorMessage = error.message;
        }

        // Check if the error has a JSON body context (common in Supabase function errors)
        if ('context' in error && typeof (error as any).context?.json === 'function') {
          try {
            const errorBody = await (error as any).context.json();
            if (errorBody?.error) {
              errorMessage = errorBody.error;
            }
          } catch {
            // ignore JSON parse error
          }
        }

        throw new Error(errorMessage);
      }

      toast({
        title: 'Verification complete',
        description: 'You are verified to play.',
      });
      onVerified();
    } catch (err) {
      toast({
        title: 'Verification failed',
        description: err instanceof Error ? err.message : 'Unable to verify',
        variant: 'destructive',
      });
    } finally {
      if (loading) setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card-game rounded-xl p-6 text-center space-y-4 max-w-sm">
        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mx-auto">
          <Shield className="w-6 h-6 text-primary" />
        </div>
        <h2 className="font-bold text-lg">Human Verification Required</h2>
        <p className="text-sm text-muted-foreground">
          This game is only for verified humans. Please verify with World ID to continue.
        </p>
        <Button
          className="w-full glow-green"
          onClick={handleVerify}
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Verifying...
            </>
          ) : (
            'Verify with World ID'
          )}
        </Button>
      </div>
    </div>
  );
};
