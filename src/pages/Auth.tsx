import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, User, Globe, ArrowRight } from 'lucide-react';
import miningBg from '@/assets/mining-bg.jpg';
import { MiniKit } from '@worldcoin/minikit-js';
import { completeWalletAuth, getAuthNonce, updateProfile } from '@/lib/backend';
import { useSession } from '@/hooks/useSession';
import { getErrorMessage } from '@/lib/error';
import { ensureMiniKit, getMiniKitErrorMessage } from '@/lib/minikit';

type AuthStep = 'signin' | 'profile';

const Auth = () => {
  const [step, setStep] = useState<AuthStep>('signin');
  const [playerName, setPlayerName] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoConnecting, setAutoConnecting] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { setSession, session } = useSession();
  const autoAuthAttempted = useRef(false);

  const triggerWalletAuth = useCallback(async () => {
    if (loading) return;
    setLoading(true);

    try {
      const miniKit = ensureMiniKit();
      if (miniKit.ok === false) {
        toast({
          title: 'World App required',
          description: getMiniKitErrorMessage(miniKit.reason),
          variant: 'destructive',
        });
        return;
      }

      const { nonce } = await getAuthNonce();

      const { finalPayload } = await MiniKit.commandsAsync.walletAuth({
        nonce,
        statement: 'Sign in to Mine to Earn',
        expirationTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        notBefore: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });

      if (finalPayload.status !== 'success') {
        const errorCode = (finalPayload as any).error_code ?? 'unknown_error';
        const details = (finalPayload as any).details;
        const detailText =
          typeof details === 'string'
            ? details
            : details
              ? JSON.stringify(details)
              : undefined;
        throw new Error(
          `Wallet auth failed: ${errorCode}${detailText ? ` (${detailText})` : ''}`
        );
      }

      let username: string | undefined;
      try {
        const user = await MiniKit.getUserByAddress(finalPayload.address);
        username = user?.username;
      } catch {
        // optional
      }

      const result = await completeWalletAuth(finalPayload, nonce, undefined, username, referralCode || undefined);

      setSession({
        token: result.session.token,
        userId: result.session.user_id,
        playerName: result.session.player_name,
        isAdmin: result.session.is_admin,
        isHumanVerified: result.session.is_human_verified,
      });

      if (!result.session.player_name || result.session.player_name === 'Miner') {
        setStep('profile');
      } else {
        toast({
          title: `Welcome back, ${result.session.player_name}!`,
          description: 'Ready to mine?',
        });
        navigate('/');
      }
    } catch (error) {
      console.error('Auth error:', error);
      toast({
        title: 'Sign In Failed',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      setAutoConnecting(false);
    }
  }, [loading, toast, setSession, navigate, referralCode]);

  // Redirect to game if session is restored (e.g. from IndexedDB async restore)
  useEffect(() => {
    if (session && step === 'signin') {
      navigate('/');
    }
  }, [session, step, navigate]);

  // Auto-trigger walletAuth inside World App so returning users don't see the auth page
  useEffect(() => {
    if (autoAuthAttempted.current || session || step !== 'signin') return;

    const miniKit = ensureMiniKit();
    if (miniKit.ok) {
      autoAuthAttempted.current = true;
      setAutoConnecting(true);
      // Small delay to let the UI render before showing World App prompt
      const timer = setTimeout(() => triggerWalletAuth(), 300);
      return () => clearTimeout(timer);
    }
  }, [session, step, triggerWalletAuth]);

  const handleWalletAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    await triggerWalletAuth();
  };

  const handleProfileSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName.trim()) {
      toast({
        title: 'Username required',
        description: 'Please enter a name to continue.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      await updateProfile({ playerName: playerName.trim() });

      if (session) {
        setSession({ ...session, playerName: playerName.trim() });
      }

      toast({
        title: `Welcome, ${playerName}!`,
        description: 'Your profile has been created.',
      });
      navigate('/');
    } catch (error) {
      toast({
        title: 'Profile Update Failed',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const suggestedNames = [
    'DiamondHunter',
    'GoldDigger',
    'CryptoMiner',
    'DeepDriller',
    'OreSeeker',
  ];

  // Show a connecting screen during auto-reauthentication
  if (autoConnecting && step === 'signin') {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-4"
        style={{
          backgroundImage: `linear-gradient(to bottom, hsl(120 10% 4% / 0.9), hsl(120 10% 4% / 0.95)), url(${miningBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="text-center space-y-4">
          <div className="text-5xl animate-float">⛏️</div>
          <h1 className="font-pixel text-xl text-primary text-glow">Mine to Earn</h1>
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground text-sm">Reconnecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4"
      style={{
        backgroundImage: `linear-gradient(to bottom, hsl(120 10% 4% / 0.9), hsl(120 10% 4% / 0.95)), url(${miningBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="w-full max-w-sm space-y-6">
        {/* Logo/Header */}
        <div className="text-center space-y-2">
          <div className="text-5xl animate-float">⛏️</div>
          <h1 className="font-pixel text-xl text-primary text-glow">Mine to Earn</h1>
          <p className="text-muted-foreground text-sm">
            {step === 'signin' ? 'Start your mining journey' : 'Setup your profile'}
          </p>
        </div>

        {step === 'signin' ? (
          /* Step 1: Sign In */
          <form onSubmit={handleWalletAuth} className="card-game rounded-xl p-6 space-y-4">
            <div className="text-center p-4">
              <Globe className="w-12 h-12 text-primary mx-auto mb-2 opacity-80" />
              <p className="text-sm text-muted-foreground">
                Connect using your World ID credentials.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="referralCode" className="text-xs text-muted-foreground">
                Referral Code (optional)
              </Label>
              <Input
                id="referralCode"
                type="text"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                placeholder="Enter referral code"
                maxLength={8}
                className="bg-secondary/50 uppercase"
              />
            </div>

            <Button type="submit" className="w-full glow-green" disabled={loading}>
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Globe className="w-4 h-4 mr-2" />
              )}
              Sign in with World App
            </Button>
          </form>
        ) : (
          /* Step 2: Profile Setup */
          <form onSubmit={handleProfileSetup} className="card-game rounded-xl p-6 space-y-4 animate-in fade-in slide-in-from-right-8">
            <div className="space-y-2">
              <Label htmlFor="playerName" className="text-sm flex items-center gap-2">
                <User className="w-4 h-4" /> Choose a Username
              </Label>
              <Input
                id="playerName"
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Enter your miner name"
                maxLength={20}
                className="bg-secondary/50"
                autoFocus
              />
            </div>

            {/* Suggested Names */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Suggestions</Label>
              <div className="flex flex-wrap gap-2">
                {suggestedNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setPlayerName(name + Math.floor(Math.random() * 1000))}
                    className="text-xs bg-secondary/50 hover:bg-secondary px-2 py-1 rounded transition-colors"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            <Button type="submit" className="w-full glow-green" disabled={loading}>
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <ArrowRight className="w-4 h-4 mr-2" />
              )}
              Complete Setup
            </Button>
          </form>
        )}

        {/* Info */}
        <div className="text-center text-xs text-muted-foreground">
          <p>World App Wallet Auth is required to play</p>
        </div>
      </div>
    </div>
  );
};

export default Auth;
