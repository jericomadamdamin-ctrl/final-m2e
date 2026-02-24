import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OilPurchaseTab } from "./OilPurchaseTab";
import { CashoutTab } from "./CashoutTab";
import { formatCompactNumber } from "@/lib/format";
import { GameConfig } from "@/types/game";

interface BankTabProps {
    oilBalance: number;
    diamondBalance: number;
    config: GameConfig;
    defaultOil?: number;
    onPurchaseComplete?: (newBalance?: number) => void;
    lastCashout?: string;
}

export const BankTab = ({
    oilBalance,
    diamondBalance,
    config,
    defaultOil,
    onPurchaseComplete,
    lastCashout
}: BankTabProps) => {
    return (
        <div className="space-y-4 pb-4">
            <div className="flex items-center justify-between px-1">
                <h2 className="font-pixel text-xs text-primary text-glow">Bank</h2>
                <div className="flex gap-2">
                    <div className="flex items-center gap-1 bg-secondary/50 px-2 py-1 rounded-full text-xs">
                        <span>🛢️</span>
                        <span className="font-bold tabular-nums max-w-[80px] truncate">{formatCompactNumber(Math.floor(oilBalance))}</span>
                    </div>
                    <div className="flex items-center gap-1 bg-secondary/50 px-2 py-1 rounded-full text-xs">
                        <span>💎</span>
                        <span className="font-bold">{Math.floor(diamondBalance)}</span>
                    </div>
                </div>
            </div>

            <Tabs defaultValue="buy" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="buy">Buy Oil</TabsTrigger>
                    <TabsTrigger value="cashout">Cashout</TabsTrigger>
                </TabsList>
                <TabsContent value="buy">
                    <OilPurchaseTab
                        defaultOil={defaultOil}
                        onComplete={onPurchaseComplete}
                    />
                </TabsContent>
                <TabsContent value="cashout">
                    <CashoutTab
                        diamonds={diamondBalance}
                        minRequired={config.cashout.minimum_diamonds_required}
                        onComplete={() => onPurchaseComplete?.()}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
};
