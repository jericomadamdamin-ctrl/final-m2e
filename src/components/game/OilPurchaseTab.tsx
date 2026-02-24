import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { MiniKit, Tokens, tokenToDecimals, type PayCommandInput, type PayCommandResult } from '@worldcoin/minikit-js';
import { confirmOilPurchase, initiateOilPurchase } from '@/lib/backend';
import { ensureMiniKit, getMiniKitErrorMessage } from '@/lib/minikit';

interface OilPurchaseTabProps {
  defaultOil?: number;
  onComplete?: (newBalance?: number) => void;
}

export const OilPurchaseTab = ({ defaultOil = 1000, onComplete }: OilPurchaseTabProps) => {
  const [token, setToken] = useState<'WLD' | 'USDC'>('WLD');
  const [oilAmount, setOilAmount] = useState(defaultOil);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handlePurchase = async () => {
    const miniKit = ensureMiniKit();
    if (!miniKit.ok) {
      toast({
        title: 'World App required',
        description: getMiniKitErrorMessage(miniKit.reason),
        variant: 'destructive',
      });
      return;
    }

    if (oilAmount <= 0) {
      toast({
        title: 'Invalid amount',
        description: 'Enter a valid OIL amount.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const init = await initiateOilPurchase(token, oilAmount);

      const tokenSymbol = token === 'WLD' ? Tokens.WLD : Tokens.USDC;
      const tokenAmount = tokenToDecimals(init.amount_token, tokenSymbol).toString();

      const payPayload: PayCommandInput = {
        reference: init.reference,
        to: init.to_address,
        tokens: [
          {
            symbol: tokenSymbol,
            token_amount: tokenAmount,
          },
        ],
        description: init.description,
      };

      const { finalPayload } = await MiniKit.commandsAsync.pay(payPayload) as PayCommandResult;

      if (finalPayload.status !== 'success') {
        throw new Error('Payment cancelled');
      }

      const result = await confirmOilPurchase(finalPayload);

      if (result.status !== 'confirmed' && result.status !== 'mined') {
        toast({
          title: 'Payment pending',
          description: 'Your payment is pending. Your OIL will be credited once confirmed.',
        });
        return;
      }

      toast({
        title: 'Payment Successful!',
        description: `+${init.amount_oil} OIL has been added to your account.`,
        className: 'glow-green'
      });
      onComplete?.(result.oil_balance);
    } catch (err: any) {
      toast({
        title: 'Purchase failed',
        description: err?.message || 'Unable to complete purchase',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="font-pixel text-xs text-primary text-glow">Buy OIL</h2>
      </div>

      <div className="card-game rounded-xl p-4 space-y-3">
        <div>
          <label className="text-xs text-muted-foreground">Payment Token</label>
          <div className="flex gap-2 mt-1">
            <Button
              type="button"
              variant={token === 'WLD' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => setToken('WLD')}
            >
              WLD
            </Button>
            <Button
              type="button"
              variant={token === 'USDC' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => setToken('USDC')}
            >
              USDC
            </Button>
          </div>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">OIL Amount (Max 1,000,000)</label>
          <Input
            type="number"
            min={1}
            max={1000000}
            value={oilAmount}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (val > 1000000) return; // Prevent excessive input
              setOilAmount(val);
            }}
            className="bg-secondary/50"
          />
        </div>

        <Button
          className="w-full glow-green"
          onClick={handlePurchase}
          disabled={loading}
        >
          {loading ? 'Processing...' : 'Pay with World App'}
        </Button>
      </div>
    </div>
  );
};
