import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { requestCashout } from '@/lib/backend';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface CashoutTabProps {
  diamonds: number;
  minRequired: number;
  onComplete?: () => void;
}

export const CashoutTab = ({ diamonds, minRequired, onComplete }: CashoutTabProps) => {
  const [amount, setAmount] = useState<number>(minRequired);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const { toast } = useToast();

  const canRequest = diamonds >= minRequired && amount > 0 && amount <= diamonds;

  const handleSubmitRaw = () => {
    if (!canRequest) return;
    setShowConfirm(true);
  };

  const handleConfirm = async () => {
    setShowConfirm(false);
    setLoading(true);
    try {
      const result = await requestCashout(amount);
      onComplete?.();

      const settlement = result.settlement;
      const description =
        settlement?.message ||
        (settlement?.refunded
          ? 'Settlement failed and diamonds were refunded.'
          : settlement?.executed
            ? 'Payment sent successfully.'
            : 'Request queued for auto-processing.');

      toast({
        title: 'Cashout requested',
        description,
      });
    } catch (err) {
      toast({
        title: 'Cashout failed',
        description: err instanceof Error ? err.message : 'Unable to request cashout',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="font-pixel text-xs text-primary text-glow">Cashout</h2>
        <div className="text-xs text-muted-foreground">Auto processing enabled</div>
      </div>

      <div className="card-game rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">Your Diamonds</div>
            <div className="text-2xl font-bold text-game-diamond">{diamonds.toFixed(2)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Min Required</div>
            <div className="text-sm font-bold">{minRequired}</div>
          </div>
        </div>
      </div>

      <div className="card-game rounded-xl p-4 space-y-3">
        <div className="text-sm font-bold">Request Payout</div>
        <Input
          type="number"
          value={amount}
          min={minRequired}
          max={Math.min(diamonds, 1000000)}
          onChange={(e) => {
            const val = Math.floor(Number(e.target.value));
            if (val > 1000000) return;
            setAmount(val);
          }}
          className="bg-secondary/50"
        />
        <Button
          className="w-full glow-green"
          disabled={!canRequest || loading}
          onClick={handleSubmitRaw}
        >
          {loading ? 'Submitting...' : 'Submit Cashout Request'}
        </Button>

        <ConfirmDialog
          open={showConfirm}
          onOpenChange={setShowConfirm}
          title="Confirm Cashout"
          description="Payout is variable and depends on total submitted diamonds and current round rate. If execution fails, diamonds are refunded. Continue?"
          onConfirm={handleConfirm}
        />
        {!canRequest && (
          <p className="text-xs text-muted-foreground">
            You need at least {minRequired} diamonds to request a cashout.
          </p>
        )}
      </div>
    </div>
  );
};
