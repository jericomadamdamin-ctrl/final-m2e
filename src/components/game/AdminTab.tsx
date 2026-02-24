import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { fetchAdminStats } from '@/lib/backend';
import { Loader2, AlertTriangle, Lock, LayoutDashboard, Settings, User, CreditCard, Activity, Trophy } from 'lucide-react';
import { GameConfig } from '@/types/game';
import { AdminStats } from '@/types/admin';
import { AdminDashboard } from './admin/AdminDashboard';
import { AdminGameConfig } from './admin/AdminGameConfig';
import { AdminUsers } from './admin/AdminUsers';
import { AdminFinancials } from './admin/AdminFinancials';
import { AdminCashout } from './admin/AdminCashout';
import { AdminSeasons } from './admin/AdminSeasons';

interface AdminTabProps {
    config: GameConfig | null;
}

const isMiniKitEnviroment = () => {
    return typeof window !== 'undefined' && (window as any).MiniKit?.isInstalled();
};

export const AdminTab = ({ config }: AdminTabProps) => {
    const [stats, setStats] = useState<AdminStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [accessKey, setAccessKey] = useState('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const { toast } = useToast();

    // Persist access key locally (session scope) so refresh doesn't drop admin access
    useEffect(() => {
        const saved = typeof window !== 'undefined' ? window.sessionStorage.getItem('admin_access_key') : null;
        if (saved) {
            setAccessKey(saved);
            setIsAuthenticated(false); // still require a fresh fetch
        }
    }, []);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            if (accessKey) window.sessionStorage.setItem('admin_access_key', accessKey);
        }
    }, [accessKey]);

    const handleLogin = async () => {
        if (!accessKey) return;
        setLoading(true);
        try {
            const data = await fetchAdminStats(accessKey);
            setStats(data);
            setIsAuthenticated(true);
        } catch (err: any) {
            toast({
                title: 'Access Denied',
                description: `Error: ${err.message}. Ensure your key matches the backend secret.`,
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    const loadStats = async () => {
        if (!isAuthenticated) return;
        setLoading(true);
        try {
            const data = await fetchAdminStats(accessKey);
            setStats(data);
        } catch (err: any) {
            toast({
                title: 'Failed to load stats',
                description: err.message,
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isAuthenticated) {
            loadStats();
        }
    }, [isAuthenticated]);

    if (!isMiniKitEnviroment() && process.env.NODE_ENV === 'production') {
        return (
            <div className="flex flex-col items-center justify-center p-8 space-y-4 animate-fade-in min-h-[50vh] text-center">
                <AlertTriangle className="w-12 h-12 text-yellow-500 mb-4" />
                <h2 className="font-pixel text-xl text-primary text-glow">Security Restriction</h2>
                <p className="text-muted-foreground max-w-xs">
                    The Game Master dashboard can only be accessed from within the World App (MiniKit).
                </p>
                <div className="text-[10px] opacity-30 mt-8 font-mono">
                    ENV_RESTRICTION: MINIKIT_ONLY
                </div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return (
            <div className="flex flex-col items-center justify-center p-6 space-y-8 animate-fade-in min-h-[70vh] relative overflow-hidden">
                {/* Background glow effects */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-primary/10 blur-[100px] rounded-full" />

                <div className="relative group">
                    <div className="absolute -inset-1 bg-gradient-to-r from-primary to-cyan-500 rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                    <div className="relative flex items-center justify-center w-20 h-20 bg-black rounded-full border border-white/10">
                        <Lock className="w-8 h-8 text-primary animate-pulse" />
                    </div>
                </div>

                <div className="text-center space-y-2 relative z-10">
                    <h2 className="font-pixel text-2xl text-primary text-glow">Game Master</h2>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">Authorized Access Only</p>
                </div>

                <Card className="w-full max-w-sm bg-black/40 backdrop-blur-xl border-primary/20 shadow-2xl relative z-10">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-center text-[11px] opacity-70">
                            Provide the cryptographic key to unlock administrative protocols.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 space-y-4">
                        <div className="relative group">
                            <Input
                                type="password"
                                placeholder="ACCESS_KEY_IDENTIFIER"
                                value={accessKey}
                                onChange={(e) => setAccessKey(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                                className="bg-black/60 border-white/10 focus:border-primary/50 text-center font-mono tracking-widest h-12 uppercase text-xs"
                            />
                        </div>
                        <Button
                            className="w-full h-12 bg-primary hover:bg-primary/80 text-black font-bold uppercase tracking-wider text-xs shadow-[0_0_20px_rgba(var(--primary-rgb),0.3)]"
                            onClick={handleLogin}
                            disabled={loading}
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Initialize Session'}
                        </Button>
                    </CardContent>
                </Card>

                <div className="text-[9px] text-muted-foreground/30 font-mono absolute bottom-4">
                    GM_AUTH_V4.0 // ENCRYPTED_CONNECTION_ACTIVE
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-24 animate-fade-in px-4">
            <header className="flex flex-col space-y-1 pt-4 border-b border-white/5 pb-4">
                <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                        <h2 className="font-pixel text-lg text-primary text-glow leading-none">GM Panel</h2>
                        <span className="text-[9px] text-muted-foreground uppercase tracking-widest mt-1">Status: Operational</span>
                    </div>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={loadStats}
                        disabled={loading}
                        className="h-8 w-8 p-0 rounded-full hover:bg-primary/10 text-primary"
                    >
                        <Activity className={cn("w-4 h-4", loading && "animate-spin")} />
                    </Button>
                </div>
            </header>

            <Tabs defaultValue="dashboard" className="w-full">
                <TabsList className="flex w-full overflow-x-auto no-scrollbar bg-black/40 p-1 rounded-xl border border-white/5 mb-6">
                    <TabsTrigger value="dashboard" className="flex-1 flex flex-col gap-1 py-3 rounded-lg data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-all">
                        <LayoutDashboard className="w-4 h-4" />
                        <span className="text-[9px] uppercase font-bold tracking-tight">Status</span>
                    </TabsTrigger>
                    <TabsTrigger value="users" className="flex-1 flex flex-col gap-1 py-3 rounded-lg data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-all">
                        <User className="w-4 h-4" />
                        <span className="text-[9px] uppercase font-bold tracking-tight">Players</span>
                    </TabsTrigger>
                    <TabsTrigger value="cashout" className="flex-1 flex flex-col gap-1 py-3 rounded-lg data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-all">
                        <CreditCard className="w-4 h-4" />
                        <span className="text-[9px] uppercase font-bold tracking-tight">Cashout</span>
                    </TabsTrigger>
                    <TabsTrigger value="financials" className="flex-1 flex flex-col gap-1 py-3 rounded-lg data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-all">
                        <Activity className="w-4 h-4" />
                        <span className="text-[9px] uppercase font-bold tracking-tight">Financials</span>
                    </TabsTrigger>
                    <TabsTrigger value="seasons" className="flex-1 flex flex-col gap-1 py-3 rounded-lg data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-all">
                        <Trophy className="w-4 h-4" />
                        <span className="text-[9px] uppercase font-bold tracking-tight">Seasons</span>
                    </TabsTrigger>
                    <TabsTrigger value="config" className="flex-1 flex flex-col gap-1 py-3 rounded-lg data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-all">
                        <Settings className="w-4 h-4" />
                        <span className="text-[9px] uppercase font-bold tracking-tight">Tools</span>
                    </TabsTrigger>
                </TabsList>

                <div className="mt-2 min-h-[50vh]">
                    <TabsContent value="dashboard">
                        <AdminDashboard stats={stats} accessKey={accessKey} />
                    </TabsContent>

                    <TabsContent value="users">
                        <AdminUsers accessKey={accessKey} />
                    </TabsContent>

                    <TabsContent value="cashout">
                        <AdminCashout accessKey={accessKey} />
                    </TabsContent>

                    <TabsContent value="financials">
                        <AdminFinancials stats={stats} accessKey={accessKey} onRefresh={loadStats} />
                    </TabsContent>

                    <TabsContent value="seasons">
                        <AdminSeasons accessKey={accessKey} />
                    </TabsContent>

                    <TabsContent value="config">
                        <AdminGameConfig accessKey={accessKey} config={config} />
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
};
