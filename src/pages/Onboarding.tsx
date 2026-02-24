import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Sparkles, User } from 'lucide-react';
import miningBg from '@/assets/mining-bg.jpg';

interface OnboardingProps {
  userId: string;
  onComplete: () => void;
}

const Onboarding = ({ userId, onComplete }: OnboardingProps) => {
  const [playerName, setPlayerName] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName.trim()) return;

    setLoading(true);
    try {
      const { error } = await supabase.from('profiles').insert({
        id: userId,
        player_name: playerName.trim(),
      });

      if (error) throw error;

      toast({
        title: 'Welcome, ' + playerName + '!',
        description: 'Your mining adventure begins now!',
      });

      onComplete();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create profile',
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
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="text-5xl animate-float">⛏️</div>
          <h1 className="font-pixel text-xl text-primary text-glow">Welcome, Miner!</h1>
          <p className="text-muted-foreground text-sm">
            Choose your mining identity
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="card-game rounded-xl p-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="playerName" className="text-sm flex items-center gap-2">
              <User className="w-4 h-4" /> Player Name
            </Label>
            <Input
              id="playerName"
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter your miner name"
              required
              maxLength={20}
              className="bg-secondary/50"
            />
          </div>

          {/* Suggested Names */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Suggestions
            </Label>
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

          <Button type="submit" className="w-full glow-green" disabled={loading || !playerName.trim()}>
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            Start Mining
          </Button>
        </form>

        {/* Info */}
        <div className="text-center text-xs text-muted-foreground">
          <p>You'll receive 200 🛢️ Oil to start your mining journey!</p>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
