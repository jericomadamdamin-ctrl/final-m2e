
import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { fetchUsers, fetchTable, updateTableRow } from '@/lib/backend';
import { Loader2, Search, RefreshCw, User, Droplets, Gem, ShieldAlert, Filter, Ban, ShieldCheck } from 'lucide-react';
import { formatCompactNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { AdminPagination, paginate } from './AdminPagination';

interface UserData {
    id: string;
    player_name: string;
    wallet_address: string;
    created_at: string;
    oil_balance: number;
    diamond_balance: number;
    is_admin: boolean;
    is_banned: boolean;
}

export const AdminUsers = ({ accessKey }: { accessKey?: string }) => {
    const { toast } = useToast();
    const [users, setUsers] = useState<UserData[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'user'>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'banned'>('all');
    const [currentPage, setCurrentPage] = useState(1);

    const loadUsers = async () => {
        if (!accessKey) return;
        setLoading(true);
        try {
            const profiles = await fetchUsers(accessKey) || [];
            const playerStates = await fetchTable('player_state', accessKey) || [];
            const playerFlags = await fetchTable('player_flags', accessKey) || [];

            const stateMap = new Map(playerStates.map((s: any) => [s.user_id, s]));
            const flagMap = new Map(playerFlags.map((f: any) => [f.user_id, f]));

            const joinedData: UserData[] = (profiles as any[]).map((p: any) => {
                const state = stateMap.get(p.id) as any;
                const flags = flagMap.get(p.id) as any;
                return {
                    id: p.id,
                    player_name: p.player_name || 'Anonymous',
                    wallet_address: p.wallet_address || '',
                    created_at: p.created_at,
                    oil_balance: state?.oil_balance || 0,
                    diamond_balance: state?.diamond_balance || 0,
                    is_admin: !!p.is_admin,
                    is_banned: !!flags?.is_shadow_banned,
                };
            });

            joinedData.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            setUsers(joinedData);
        } catch (err) {
            console.error("Failed to load users", err);
        } finally {
            setLoading(false);
        }
    };

    const handleBanToggle = async (userId: string, currentBanned: boolean) => {
        if (!accessKey) return;
        try {
            await updateTableRow('player_flags', userId, { is_shadow_banned: !currentBanned, shadow_ban_at: !currentBanned ? new Date().toISOString() : null }, accessKey);
            toast({
                title: !currentBanned ? 'User Banned' : 'Ban Lifted',
                description: `ID: ${userId.slice(0, 8)} status updated.`,
                variant: !currentBanned ? 'destructive' : 'default'
            });
            await loadUsers();
        } catch (err: any) {
            toast({ title: 'Operation Failed', description: err.message, variant: 'destructive' });
        }
    };

    useEffect(() => { loadUsers(); }, [accessKey]);

    const filteredUsers = users.filter(user => {
        const matchesSearch = (user.player_name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
            (user.wallet_address?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
            (user.id?.toLowerCase() || '').includes(searchTerm.toLowerCase());

        const matchesRole = roleFilter === 'all' || (roleFilter === 'admin' ? user.is_admin : !user.is_admin);
        const matchesStatus = statusFilter === 'all' || (statusFilter === 'banned' ? user.is_banned : !user.is_banned);

        return matchesSearch && matchesRole && matchesStatus;
    });

    const paginatedUsers = paginate(filteredUsers, currentPage);

    // Reset to page 1 when filters change
    useEffect(() => { setCurrentPage(1); }, [searchTerm, roleFilter, statusFilter]);

    return (
        <div className="space-y-4 animate-fade-in px-1">
            {/* Search and Refresh */}
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                        placeholder="Search records..."
                        className="pl-9 h-10 bg-white/5 border-white/10 rounded-xl text-xs"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <Button size="icon" variant="outline" onClick={loadUsers} disabled={loading} className="h-10 w-10 rounded-xl bg-white/5 border-white/10">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                </Button>
            </div>

            {/* Filter Bar */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
                <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <div className="flex bg-white/5 p-1 rounded-lg border border-white/5 gap-1 shrink-0">
                    {['all', 'admin', 'user'].map((f) => (
                        <button
                            key={f}
                            onClick={() => setRoleFilter(f as any)}
                            className={cn(
                                "px-3 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all",
                                roleFilter === f ? "bg-primary text-black" : "text-muted-foreground hover:bg-white/5"
                            )}
                        >
                            {f}
                        </button>
                    ))}
                </div>
                <div className="flex bg-white/5 p-1 rounded-lg border border-white/5 gap-1 shrink-0">
                    {['all', 'active', 'banned'].map((f) => (
                        <button
                            key={f}
                            onClick={() => setStatusFilter(f as any)}
                            className={cn(
                                "px-3 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all",
                                statusFilter === f ? "bg-primary text-black" : "text-muted-foreground hover:bg-white/5"
                            )}
                        >
                            {f}
                        </button>
                    ))}
                </div>
            </div>

            {/* User Grid */}
            <div className="space-y-4">
                {loading && users.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 space-y-4">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        <span className="text-[10px] uppercase tracking-widest opacity-40">Decrypting Identities...</span>
                    </div>
                ) : paginatedUsers.length === 0 ? (
                    <div className="text-center py-20 bg-white/5 rounded-2xl border border-dashed border-white/10">
                        <User className="w-8 h-8 mx-auto mb-2 opacity-10" />
                        <p className="text-xs text-muted-foreground">No matching records found.</p>
                    </div>
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                        {paginatedUsers.map((user) => (
                            <Card key={user.id} className={cn("bg-white/5 border-white/5 backdrop-blur-md overflow-hidden relative group", user.is_banned && "opacity-75 grayscale-[0.5]")}>
                                <CardContent className="p-4">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center text-primary border shrink-0", user.is_banned ? "bg-red-500/10 border-red-500/20" : "bg-primary/20 border-primary/20")}>
                                                <span className="font-pixel text-xs">{user.player_name.charAt(0).toUpperCase()}</span>
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-bold truncate">{user.player_name}</span>
                                                    {user.is_admin && <div className="text-[8px] px-1 bg-primary/20 text-primary border border-primary/20 rounded">ADM</div>}
                                                    {user.is_banned && <div className="text-[8px] px-1 bg-red-500/20 text-red-500 border border-red-500/20 rounded flex items-center gap-1"><ShieldAlert className="w-2 h-2" /> BANNED</div>}
                                                </div>
                                                <span className="text-[8px] text-muted-foreground font-mono opacity-40 truncate">#{user.id.slice(0, 8)}</span>
                                            </div>
                                        </div>
                                        <span className="text-[8px] text-muted-foreground font-mono opacity-40">{new Date(user.created_at).toLocaleDateString()}</span>
                                    </div>

                                    <div className="mt-3 grid grid-cols-2 gap-2">
                                        <StatMini label="Reserves" value={user.oil_balance} icon={<Droplets className="w-2.5 h-2.5 text-orange-500" />} />
                                        <StatMini label="Diamonds" value={user.diamond_balance} icon={<Gem className="w-2.5 h-2.5 text-game-diamond" />} />
                                    </div>

                                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/5 pt-3">
                                        <span className="text-[8px] text-muted-foreground font-mono truncate opacity-60">
                                            {user.wallet_address ? `${user.wallet_address.slice(0, 6)}...${user.wallet_address.slice(-4)}` : 'UNKNOWN_WALLET'}
                                        </span>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => handleBanToggle(user.id, user.is_banned)}
                                            className={cn("h-7 px-2 text-[9px] uppercase tracking-widest", user.is_banned ? "text-green-500 hover:bg-green-500/10" : "text-red-500 hover:bg-red-500/10")}
                                        >
                                            {user.is_banned ? <><ShieldCheck className="w-3 h-3 mr-1" /> Unban</> : <><Ban className="w-3 h-3 mr-1" /> Ban</>}
                                        </Button>
                                    </div>
                                </CardContent>
                                {user.is_banned && <div className="absolute top-0 right-0 p-2"><ShieldAlert className="w-4 h-4 text-red-500" /></div>}
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            <AdminPagination
                currentPage={currentPage}
                totalItems={filteredUsers.length}
                onPageChange={setCurrentPage}
                label={`${filteredUsers.length} player${filteredUsers.length !== 1 ? 's' : ''}`}
            />

            <div className="py-6 flex flex-col items-center gap-2 opacity-20">
                <span className="text-[8px] uppercase tracking-[0.4em]">Matrix Registry Active</span>
            </div>
        </div>
    );
};

const StatMini = ({ label, value, icon }: { label: string, value: number, icon: React.ReactNode }) => (
    <div className="p-2 rounded-lg bg-black/40 border border-white/5">
        <div className="text-[7px] text-muted-foreground uppercase font-bold tracking-widest opacity-40 mb-1">{label}</div>
        <div className="text-xs font-mono flex items-center gap-1.5">
            {icon}
            {formatCompactNumber(value)}
        </div>
    </div>
);
