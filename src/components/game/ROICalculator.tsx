import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calculator, AlertTriangle } from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import { GameConfig } from '@/types/game';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { formatCompactNumber } from '@/lib/format';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ROICalculatorProps {
    config: GameConfig;
}

export const ROICalculator = ({ config }: ROICalculatorProps) => {
    const taxRatePercent = Number(config.cashout?.tax_rate_percent ?? 30);
    const diamondTaxRate = Math.max(0, Math.min(1, taxRatePercent / 100));
    const adminDiamondRate = Number(config.cashout?.diamond_wld_exchange_rate ?? 0.1);
    const [isOpen, setIsOpen] = useState(false);
    const [selectedMachine, setSelectedMachine] = useState<string>(Object.keys(config.machines)[0] || '');
    const [level, setLevel] = useState<number>(1);
    const [projectedDiamondPrice, setProjectedDiamondPrice] = useState<number>(adminDiamondRate);

    useEffect(() => {
        // Keep visible default synced with admin-defined exchange rate.
        setProjectedDiamondPrice(adminDiamondRate);
    }, [adminDiamondRate]);

    const stats = useMemo(() => {
        if (!selectedMachine || !config.machines[selectedMachine]) return null;

        const mConfig = config.machines[selectedMachine];
        const prog = config.progression;
        const dailyCap = config.diamond_controls?.daily_cap_per_user || 1000;

        // Multipliers
        const speedMult = 1 + Math.max(0, level - 1) * prog.level_speed_multiplier;
        const burnMult = 1 + Math.max(0, level - 1) * prog.level_oil_burn_multiplier;
        // Cost Multiplier Logic: 
        // Base cost is mConfig.cost_oil.
        // Upgrade from L to L+1 is: base * L * upgrade_cost_multiplier.
        // Total Investment = Base + Sum(Upgrade Costs).

        let totalOilCost = mConfig.cost_oil;
        for (let l = 1; l < level; l++) {
            totalOilCost += Math.floor(mConfig.cost_oil * l * prog.upgrade_cost_multiplier);
        }

        const baseWldCost = mConfig.cost_wld || 0;
        const oilPerWld = config.pricing.oil_per_wld || 1000;

        const totalCostWld = baseWldCost + (totalOilCost / oilPerWld);

        // Production
        const actionsPerHour = mConfig.speed_actions_per_hour * speedMult;

        // Revenue (Oil from Minerals)
        let oilFromMineralsPerAction = 0;
        Object.values(config.mining.action_rewards.minerals).forEach(m => {
            oilFromMineralsPerAction += m.drop_rate * m.oil_value;
        });

        const oilRevenuePerHour = actionsPerHour * oilFromMineralsPerAction;
        const oilRevenuePerDay = oilRevenuePerHour * 24;

        // Revenue (Diamonds) - WITH CAP LOGIC
        const diamondsPerAction = config.mining.action_rewards.diamond.drop_rate_per_action;
        const uncappedDiamondsPerHour = actionsPerHour * diamondsPerAction;
        const uncappedDiamondsPerDay = uncappedDiamondsPerHour * 24;

        // Apply Cap
        const diamondsPerDay = Math.min(uncappedDiamondsPerDay, dailyCap);
        const isCapped = uncappedDiamondsPerDay > dailyCap;
        const excessDiamondsPerDay = Math.max(0, uncappedDiamondsPerDay - diamondsPerDay);
        const excessDiamondOilValue = Number(config.diamond_controls?.excess_diamond_oil_value || 0);
        const excessOilPerDay = excessDiamondsPerDay * excessDiamondOilValue;

        // Expenses (Fuel)
        const oilBurnPerHour = mConfig.oil_burn_per_hour * burnMult;
        const oilBurnPerDay = oilBurnPerHour * 24;

        // Net Analysis (in WLD)
        const netOilPerDay = oilRevenuePerDay + excessOilPerDay - oilBurnPerDay;
        const netOilWldValue = netOilPerDay / oilPerWld;
        const diamondGrossWldValue = diamondsPerDay * projectedDiamondPrice;
        const diamondTaxWldValue = diamondGrossWldValue * diamondTaxRate;
        const diamondNetWldValue = diamondGrossWldValue - diamondTaxWldValue;

        const totalDailyProfitWldGross = netOilWldValue + diamondGrossWldValue;
        const totalDailyProfitWldNet = netOilWldValue + diamondNetWldValue;

        const roiDays = totalDailyProfitWldNet > 0 ? totalCostWld / totalDailyProfitWldNet : Infinity;

        return {
            totalCostWld,
            totalOilCost,
            actionsPerHour,
            oilBurnPerDay,
            oilRevenuePerDay,
            diamondsPerDay,
            uncappedDiamondsPerDay,
            isCapped,
            excessDiamondsPerDay,
            excessOilPerDay,
            netOilPerDay,
            diamondGrossWldValue,
            diamondTaxWldValue,
            diamondNetWldValue,
            totalDailyProfitWldGross,
            totalDailyProfitWldNet,
            roiDays
        };
    }, [config, selectedMachine, level, projectedDiamondPrice, diamondTaxRate]);

    if (!stats) return null;

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="icon" className="w-8 h-8 rounded-lg bg-orange-500/10 border-orange-500/20 hover:bg-orange-500/20 text-orange-500">
                    <Calculator className="w-4 h-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm sm:max-w-md bg-zinc-950 border-white/10 text-white">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Calculator className="w-5 h-5 text-orange-500" />
                        <span>ROI Calculator</span>
                    </DialogTitle>
                    <DialogDescription>
                        Estimate returns based on current network difficulty.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-2">
                    {/* Controls */}
                    <div className="space-y-4 bg-white/5 p-4 rounded-xl border border-white/5">
                        <div className="space-y-2">
                            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Machine Type</Label>
                            <Select value={selectedMachine} onValueChange={setSelectedMachine}>
                                <SelectTrigger className="bg-black/40 border-white/10">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-900 border-white/10">
                                    {Object.entries(config.machines).map(([key, m]) => (
                                        <SelectItem key={key} value={key}>
                                            {m.name || key}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-3">
                            <div className="flex justify-between">
                                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Level</Label>
                                <span className="text-xs font-mono font-bold text-primary">Lvl {level}</span>
                            </div>
                            <Slider
                                value={[level]}
                                onValueChange={([v]) => setLevel(v)}
                                min={1}
                                max={config.machines[selectedMachine]?.max_level || 30}
                                step={1}
                                className="py-2"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Proj. Diamond Price (WLD)</Label>
                            <Input
                                type="number"
                                value={projectedDiamondPrice}
                                onChange={(e) => setProjectedDiamondPrice(Number(e.target.value))}
                                step={0.01}
                                className="bg-black/40 border-white/10 h-8 font-mono text-xs"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Admin base rate: {adminDiamondRate}
                            </p>
                        </div>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-3">
                        <StatCard
                            label="Total Cost"
                            value={`${formatCompactNumber(stats.totalCostWld)} WLD`}
                            subValue={`${formatCompactNumber(stats.totalOilCost)} OIL`}
                        />
                        <StatCard
                            label="Daily Profit (Net)"
                            value={`${formatCompactNumber(stats.totalDailyProfitWldNet)} WLD`}
                            subValue={
                                <>
                                    Gross {formatCompactNumber(stats.totalDailyProfitWldGross)} WLD • Tax {formatCompactNumber(stats.diamondTaxWldValue)} WLD
                                </>
                            }
                            highlight={stats.totalDailyProfitWldNet > 0}
                            warning={stats.isCapped}
                        />
                        <StatCard
                            label="Oil Balance/Day"
                            value={formatCompactNumber(stats.netOilPerDay)}
                            subValue={
                                stats.excessOilPerDay > 0
                                    ? `Includes ${formatCompactNumber(stats.excessOilPerDay)} OIL from capped gems`
                                    : stats.netOilPerDay >= 0
                                        ? 'Self-Sustaining'
                                        : 'Consumes Oil'
                            }
                            negative={stats.netOilPerDay < 0}
                        />
                        <StatCard
                            label="Tax Deduction"
                            value={`${formatCompactNumber(stats.diamondTaxWldValue)} WLD`}
                            subValue={`${taxRatePercent}% on diamond cashout value`}
                            warning={stats.diamondTaxWldValue > 0}
                        />
                        <StatCard
                            label="ROI Period"
                            value={stats.roiDays === Infinity || stats.roiDays < 0 ? "Never" : `${stats.roiDays.toFixed(1)} Days`}
                            subValue={stats.isCapped ? "Net after tax + cap impact" : `Net after ${taxRatePercent}% tax`}
                            highlight={stats.roiDays < 30 && stats.roiDays > 0}
                            warning={stats.isCapped}
                        />
                    </div>

                    {stats.isCapped && (
                        <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 text-xs text-orange-200 flex gap-2 items-start">
                            <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                            <div>
                                <span className="font-bold text-orange-500">Daily Cap Limitation:</span>
                                <br />
                                This machine setup produces <strong>{formatCompactNumber(stats.uncappedDiamondsPerDay)}</strong> gems/day, checking against the global limit of <strong>{formatCompactNumber(stats.diamondsPerDay)}</strong>. Excess gems are converted to oil.
                            </div>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

interface StatCardProps {
    label: string;
    value: string;
    subValue: string | React.ReactNode;
    highlight?: boolean;
    negative?: boolean;
    warning?: boolean;
}

const StatCard = ({ label, value, subValue, highlight, negative, warning }: StatCardProps) => (
    <Card className={`bg-white/5 border-white/10 overflow-hidden 
        ${highlight ? 'border-green-500/30 bg-green-500/5' : ''} 
        ${negative ? 'border-red-500/30 bg-red-500/5' : ''}
        ${warning ? 'border-orange-500/30 bg-orange-500/5' : ''}
    `}>
        <CardContent className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">{label}</div>
            <div className={`text-lg font-bold tracking-tight 
                ${highlight ? 'text-green-400' : ''} 
                ${negative ? 'text-red-400' : ''}
                ${warning ? 'text-orange-400' : ''}
                ${!highlight && !negative && !warning ? 'text-white' : ''}
            `}>
                {value}
            </div>
            <div className="text-[9px] text-muted-foreground opacity-70 truncate">
                {subValue}
            </div>
        </CardContent>
    </Card>
);
