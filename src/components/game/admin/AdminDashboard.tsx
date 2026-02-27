import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AdminStats } from '@/types/admin';
import { Users, Droplets, Gem, Layers, Clock, TrendingUp, DollarSign, Calendar, Search, Loader2 } from 'lucide-react';
import { formatCompactNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { fetchMiningDiagnostic } from '@/lib/backend';
import { useToast } from '@/hooks/use-toast';

interface AdminDashboardProps {
    stats: AdminStats | null;
    accessKey?: string;
}

export const AdminDashboard = ({ stats, accessKey }: AdminDashboardProps) => {
    const { toast } = useToast();
    const [diagnosticPlayer, setDiagnosticPlayer] = useState('');
    const [diagnosticResult, setDiagnosticResult] = useState<Awaited<ReturnType<typeof fetchMiningDiagnostic>> | null>(null);
    const [diagnosticLoading, setDiagnosticLoading] = useState(false);
    const [dailyEarnings, setDailyEarnings] = useState(0);
    const [todayStr, setTodayStr] = useState('');

    useEffect(() => {
        const now = new Date();
        const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
        setTodayStr(new Date(startOfDay).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));
        if (stats?.daily_revenue_wld_total !== undefined) {
            setDailyEarnings(Number(stats.daily_revenue_wld_total || 0));
        }
    }, [stats]);

    return (
        <div className="space-y-6 animate-fade-in px-1">
            {/* Mining Diagnostic - prominent at top */}
            <Card className="bg-white/5 border-primary/30 backdrop-blur-sm">
                <CardHeader className="pb-2">
                    <CardTitle className="text-xs flex items-center gap-2">
                        <Search className="w-3.5 h-3.5 text-primary" />
                        Mining Diagnostic
                    </CardTitle>
                    <p className="text-[10px] text-muted-foreground">
                        Check diamond calculation for a player. Enter username (e.g. Noklekzaja.6977).
                    </p>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex gap-2">
                        <Input
                            placeholder="Player name"
                            value={diagnosticPlayer}
                            onChange={(e) => setDiagnosticPlayer(e.target.value)}
                            className="bg-black/40 text-sm"
                        />
                        <Button
                            size="sm"
                            onClick={async () => {
                                if (!diagnosticPlayer.trim()) return;
                                setDiagnosticLoading(true);
                                setDiagnosticResult(null);
                                try {
                                    const r = await fetchMiningDiagnostic(diagnosticPlayer.trim(), accessKey);
                                    setDiagnosticResult(r);
                                } catch (err: any) {
                                    toast({ title: 'Diagnostic failed', description: err.message, variant: 'destructive' });
                                } finally {
                                    setDiagnosticLoading(false);
                                }
                            }}
                            disabled={diagnosticLoading}
                        >
                            {diagnosticLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Check'}
                        </Button>
                    </div>
                    {diagnosticResult && (
                        <div className="text-xs space-y-2 p-3 rounded-lg bg-black/30 border border-white/5">
                            <div><span className="text-muted-foreground">User:</span> {diagnosticResult.user.player_name}</div>
                            <div><span className="text-muted-foreground">Diamonds:</span> {diagnosticResult.player_state?.diamond_balance ?? '—'}</div>
                            <div><span className="text-muted-foreground">Daily cap:</span> {diagnosticResult.config.daily_cap_per_user} | <span className="text-muted-foreground">Drop rate:</span> {(diagnosticResult.config.diamond_drop_rate * 100).toFixed(1)}%</div>
                            <div className="text-[10px] text-muted-foreground">{diagnosticResult.note}</div>
                            <div className="space-y-1">
                                <span className="text-muted-foreground">Machines:</span>
                                {diagnosticResult.machines.map((m, i) => (
                                    <div key={i} className="pl-2 text-[10px]">
                                        {m.type} L{m.level} | fuel: {m.fuel_oil} | ~{m.expected_diamonds_per_hour} diamonds/hr | max {m.max_hours_by_fuel}h by fuel
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-4">
                <StatCard
                    title="Daily Revenue (UTC)"
                    value={`${dailyEarnings.toFixed(2)} WLD`}
                    subtitle={todayStr}
                    icon={<DollarSign className="w-4 h-4" />}
                    color="primary"
                    className="col-span-2 border-primary/40 bg-primary/10"
                />
                <StatCard
                    title="Total Players"
                    value={formatCompactNumber(stats?.total_users || 0)}
                    icon={<Users className="w-4 h-4" />}
                    color="primary"
                />
                <StatCard
                    title="Global Oil"
                    value={formatCompactNumber(stats?.total_oil || 0)}
                    icon={<Droplets className="w-4 h-4" />}
                    color="orange"
                />
                <StatCard
                    title="Diamond Supply"
                    value={formatCompactNumber(stats?.total_diamonds || 0)}
                    icon={<Gem className="w-4 h-4" />}
                    color="cyan"
                    className="col-span-2"
                />
            </div>

            <div className="space-y-3 pt-2">
                <div className="flex items-center gap-2 px-1 text-muted-foreground">
                    <TrendingUp className="w-3 h-3" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Network Activity</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Card className="bg-white/5 border-white/5 backdrop-blur-sm">
                        <CardContent className="p-4 py-3">
                            <div className="text-[10px] text-muted-foreground uppercase mb-1">Open Rounds</div>
                            <div className="text-xl font-bold flex items-center gap-2">
                                <Layers className="w-4 h-4 text-primary/50" />
                                {stats?.open_rounds?.length || 0}
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-white/5 border-white/5 backdrop-blur-sm">
                        <CardContent className="p-4 py-3">
                            <div className="text-[10px] text-muted-foreground uppercase mb-1">Execution</div>
                            <div className="text-xl font-bold flex items-center gap-2">
                                <Clock className="w-4 h-4 text-yellow-500/50" />
                                {stats?.execution_rounds?.length || 0}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
};

interface StatCardProps {
    title: string;
    value: string;
    subtitle?: string;
    icon: React.ReactNode;
    color: 'primary' | 'orange' | 'cyan';
    className?: string;
}

const StatCard = ({ title, value, subtitle, icon, color, className }: StatCardProps) => {
    const colorClasses = {
        primary: "text-primary border-primary/20 bg-primary/5 shadow-[0_0_20px_rgba(var(--primary-rgb),0.05)]",
        orange: "text-orange-500 border-orange-500/20 bg-orange-500/5 shadow-[0_0_20px_rgba(249,115,22,0.05)]",
        cyan: "text-cyan-400 border-cyan-400/20 bg-cyan-400/5 shadow-[0_0_20px_rgba(34,211,238,0.05)]",
    };

    return (
        <Card className={cn("overflow-hidden border group backdrop-blur-md relative", colorClasses[color], className)}>
            <div className="absolute top-0 right-0 p-3 opacity-20 group-hover:opacity-40 transition-opacity">
                {icon}
            </div>
            <CardHeader className="p-4 pb-0">
                <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">{title}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-1">
                <div className="text-2xl font-bold tracking-tight">{value}</div>
                {subtitle && <div className="text-[9px] font-mono opacity-40 mt-1 flex items-center gap-1"><Calendar className="w-2.5 h-2.5" /> {subtitle}</div>}
            </CardContent>
            {/* Gloss effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
        </Card>
    );
};
