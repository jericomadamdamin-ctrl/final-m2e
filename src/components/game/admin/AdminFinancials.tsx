import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { processCashoutRound, executeCashoutPayouts, fetchPendingTransactions, verifyTransaction, verifySingleTransaction, rejectTransaction, verifyAllPendingTransactions, recalculateCashoutRound, checkTreasuryBalance, fetchGlobalGameSettings } from '@/lib/backend';
import { Loader2, Play, DollarSign, CheckCircle, CreditCard, RefreshCw, Droplets, Layers, ShieldCheck, Edit, Save } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { formatCompactNumber } from '@/lib/format';
import { AdminStats } from '@/types/admin';
import { AdminPagination, paginate } from './AdminPagination';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface AdminFinancialsProps {
    stats: AdminStats | null;
    accessKey: string;
    onRefresh: () => void;
}

export const AdminFinancials = ({ stats, accessKey, onRefresh }: AdminFinancialsProps) => {
    const { toast } = useToast();
    const [pendingOil, setPendingOil] = useState<any[]>([]);
    const [pendingMachines, setPendingMachines] = useState<any[]>([]);
    const [pendingSlots, setPendingSlots] = useState<any[]>([]);
    const [loadingPending, setLoadingPending] = useState(false);
    const [verifyingAll, setVerifyingAll] = useState(false);
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [manualPools, setManualPools] = useState<Record<string, string>>({});
    const [editRoundId, setEditRoundId] = useState<string | null>(null);
    const [editPoolValue, setEditPoolValue] = useState<string>('');
    const [verifyId, setVerifyId] = useState<string | null>(null);
    const [verifyType, setVerifyType] = useState<'oil' | 'machine' | 'slot' | null>(null);
    const [manualTxId, setManualTxId] = useState('');
    const [exchangeRate, setExchangeRate] = useState<number | null>(null);

    // Per-section pagination
    const [oilPage, setOilPage] = useState(1);
    const [machinePage, setMachinePage] = useState(1);
    const [slotPage, setSlotPage] = useState(1);
    const [executionPage, setExecutionPage] = useState(1);

    // Confirmation dialog state
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmConfig, setConfirmConfig] = useState({
        title: '',
        description: '',
        onConfirm: () => { },
        variant: 'default' as 'default' | 'destructive'
    });

    const loadPending = async () => {
        setLoadingPending(true);
        try {
            const data = await fetchPendingTransactions(accessKey);
            setPendingOil(data.oil);
            setPendingMachines(data.machines);
            setPendingSlots(data.slots || []);
            // Reset pages when data reloads
            setOilPage(1);
            setMachinePage(1);
            setSlotPage(1);
        } catch (err: any) {
            console.error("Failed to load pending transactions", err);
        } finally {
            setLoadingPending(false);
        }
    };

    useEffect(() => {
        loadPending();
        // Fetch exchange rate
        fetchGlobalGameSettings(accessKey).then(settings => {
            if (settings?.diamond_wld_exchange_rate) {
                setExchangeRate(settings.diamond_wld_exchange_rate);
            }
        });
    }, [accessKey]);

    const handleVerifyAll = async () => {
        if (!confirm('Run World API verification on ALL pending transactions with a stored transaction_id? Already-credited wallets will only get their DB status updated.')) return;
        setVerifyingAll(true);
        try {
            const data = await verifyAllPendingTransactions(accessKey);
            const { summary } = data;
            toast({
                title: 'Batch Verification Complete',
                description: `Confirmed: ${summary.confirmed} (${summary.credited} newly credited), Skipped: ${summary.skipped}, Failed: ${summary.failed}`,
                className: summary.confirmed > 0 ? 'glow-green' : undefined,
            });
            loadPending();
        } catch (err: any) {
            toast({
                title: 'Batch Verification Failed',
                description: err.message,
                variant: 'destructive',
            });
        } finally {
            setVerifyingAll(false);
        }
    };

    const handleVerify = async (type: 'oil' | 'machine' | 'slot', id: string) => {
        // Check if we have this item in state to see if it has a tx id
        const item = [...pendingOil, ...pendingMachines, ...pendingSlots].find(i => i.id === id);

        if (item?.transaction_id) {
            // If it has a transaction ID, use safer single verify
            if (!confirm(`Verify this ${type} transaction with World API? Reference: ${item.reference}`)) return;
            setProcessingId(id);
            try {
                await verifySingleTransaction(type, id, item.transaction_id, accessKey);
                toast({ title: 'Verified', description: 'Transaction confirmed via World API.', className: 'glow-green' });
                loadPending();
            } catch (err: any) {
                toast({ title: 'Verification Failed', description: err.message, variant: 'destructive' });
            } finally {
                setProcessingId(null);
            }
        } else {
            // No transaction ID - prompt user
            setVerifyType(type);
            setVerifyId(id);
            setManualTxId('');
        }
    };

    const confirmManualVerify = async () => {
        if (!verifyId || !verifyType) return;
        setProcessingId(verifyId);
        try {
            if (manualTxId.trim()) {
                // Verify with provided ID
                await verifySingleTransaction(verifyType, verifyId, manualTxId.trim(), accessKey);
                toast({ title: 'Verified', description: 'Transaction confirmed with manual ID.', className: 'glow-green' });
            } else {
                // Force verify (bypass check)
                if (!confirm("Force confirm without Transaction ID? This skips World API verification.")) throw new Error("Cancelled");
                await verifyTransaction(verifyType, verifyId, accessKey);
                toast({ title: 'Force Confirmed', description: 'Transaction manually confirmed.', className: 'glow-green' });
            }
            loadPending();
            setVerifyId(null);
        } catch (err: any) {
            toast({ title: 'Failed', description: err.message, variant: 'destructive' });
        } finally {
            setProcessingId(null);
        }
    };

    const handleReject = async (type: 'oil' | 'machine' | 'slot', id: string) => {
        if (!confirm('Are you sure you want to REJECT this purchase? It will be marked as failed.')) return;
        setProcessingId(id);
        try {
            await rejectTransaction(type, id, accessKey);
            toast({
                title: 'Transaction Rejected',
                description: 'Marked as failed.',
            });
            loadPending();
        } catch (err: any) {
            toast({
                title: 'Rejection Failed',
                description: err.message,
                variant: 'destructive',
            });
        } finally {
            setProcessingId(null);
        }
    };

    const handleProcessRound = async (roundId: string) => {
        try {
            console.log('[handleProcessRound] Starting for round:', roundId);

            // Find the round
            const round = stats?.open_rounds?.find(r => r.id === roundId);
            if (!round) {
                toast({ title: '❌ Round Not Found', description: 'Please refresh.', variant: 'destructive' });
                return;
            }

            const poolOverride = manualPools[roundId] ? parseFloat(manualPools[roundId]) : undefined;

            // Use fetched exchange rate or default
            const rate = exchangeRate || 0.1;
            const expectedPool = poolOverride ?? (Number(round.total_diamonds || 0) * rate);

            // Check treasury balance
            try {
                const balanceCheck = await checkTreasuryBalance(expectedPool);
                if (!balanceCheck.sufficient) {
                    toast({
                        title: '⚠️ Treasury Balance Low',
                        description: `Treasury has ${balanceCheck.balance.toFixed(2)} WLD but needs ${expectedPool.toFixed(2)} WLD.`,
                        variant: 'destructive',
                        duration: 8000,
                    });
                    return;
                }
            } catch (err) {
                console.error('Balance check failed', err);
            }

            // Construct dialog message
            const description = poolOverride !== undefined
                ? `⚠️ MANUAL OVERRIDE: Closing round with ${poolOverride} WLD pool (Ignoring rate).`
                : `Close round and distribute ${expectedPool.toFixed(2)} WLD? (Based on ${formatCompactNumber(round.total_diamonds)} diamonds @ ${rate} WLD/diamond)`;

            // Open confirmation dialog
            setConfirmConfig({
                title: poolOverride !== undefined ? 'Confirm Manual Override' : 'Finalize & Distribute',
                description,
                variant: poolOverride !== undefined ? 'destructive' : 'default',
                onConfirm: async () => {
                    setProcessingId(roundId);
                    try {
                        const result = await processCashoutRound(roundId, accessKey, poolOverride);
                        toast({
                            title: '✅ Round Processed',
                            description: `Distributed ${result.payout_pool} WLD for ${result.total_diamonds} diamonds.`,
                            className: 'glow-green',
                        });
                        setManualPools(prev => {
                            const next = { ...prev };
                            delete next[roundId];
                            return next;
                        });
                        onRefresh();
                    } catch (err: any) {
                        toast({ title: 'Failed', description: err.message, variant: 'destructive' });
                    } finally {
                        setProcessingId(null);
                        setConfirmOpen(false);
                    }
                }
            });
            setConfirmOpen(true);
        } catch (err: any) {
            console.error('Error in handleProcessRound:', err);
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
        }
    };

    const handleRecalculate = async () => {
        if (!editRoundId) return;
        const poolVal = parseFloat(editPoolValue);
        if (isNaN(poolVal) || poolVal < 0) {
            toast({ title: 'Invalid Amount', description: 'Please enter a valid positive number.', variant: 'destructive' });
            return;
        }

        setProcessingId(editRoundId);
        try {
            const result = await recalculateCashoutRound(editRoundId, poolVal, accessKey);
            toast({
                title: 'Recalculation Complete',
                description: `Updated payouts. New Pool: ${result.payout_pool} WLD.`,
                className: 'glow-green',
            });
            setEditRoundId(null);
            setEditPoolValue('');
            onRefresh();
        } catch (err: any) {
            toast({
                title: 'Recalculation Failed',
                description: err.message,
                variant: 'destructive',
            });
        } finally {
            setProcessingId(null);
        }
    };

    const handleExecutePayouts = async (roundId: string) => {
        if (!confirm('Are you sure you want to EXECUTE these payouts? This will send WLD from the backend wallet.')) return;
        setProcessingId(roundId);
        try {
            const result = await executeCashoutPayouts(roundId, accessKey);
            const paid = result.results.filter((r: any) => r.status === 'paid').length;
            const failed = result.results.filter((r: any) => r.status === 'failed').length;
            toast({
                title: 'Execution Complete',
                description: `Paid: ${paid}, Failed: ${failed}. Check logs for details.`,
                className: paid > 0 ? 'glow-green' : 'destructive',
            });
            onRefresh();
        } catch (err: any) {
            toast({
                title: 'Execution Failed',
                description: err.message,
                variant: 'destructive',
            });
        } finally {
            setProcessingId(null);
        }
    };

    const totalPending = pendingOil.length + pendingMachines.length + pendingSlots.length;

    return (
        <>
            <div className="space-y-6 animate-fade-in px-1 pb-10">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 bg-white/5 p-4 rounded-2xl border border-white/5">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                            <CreditCard className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="font-bold text-sm tracking-tight">Pending Approval</h3>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                                {totalPending} awaiting verification
                            </p>
                        </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={handleVerifyAll}
                            disabled={verifyingAll || loadingPending || totalPending === 0}
                            className="h-9 rounded-xl border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 text-[9px] font-bold uppercase tracking-widest gap-1.5 flex-1 sm:flex-none"
                        >
                            {verifyingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                            Verify All
                        </Button>
                        <Button size="sm" variant="outline" onClick={loadPending} disabled={loadingPending} className="h-9 w-9 p-0 rounded-xl border-white/10 bg-black/20 shrink-0">
                            {loadingPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        </Button>
                    </div>
                </div>

                {/* Pending Sections */}
                <div className="space-y-6">
                    {/* Pending Oil */}
                    <PendingSection
                        icon={<Droplets className="w-3 h-3 text-orange-500" />}
                        label="Oil Acquisitions"
                        items={pendingOil}
                        type="oil"
                        page={oilPage}
                        onPageChange={setOilPage}
                        onVerify={handleVerify}
                        onReject={handleReject}
                        processingId={processingId}
                        emptyText="No pending oil transfers"
                    />

                    {/* Pending Machines */}
                    <PendingSection
                        icon={<Layers className="w-3 h-3 text-primary" />}
                        label="Machine Purchases"
                        items={pendingMachines}
                        type="machine"
                        page={machinePage}
                        onPageChange={setMachinePage}
                        onVerify={handleVerify}
                        onReject={handleReject}
                        processingId={processingId}
                        emptyText="No pending machine orders"
                    />

                    {/* Pending Slots */}
                    <PendingSection
                        icon={<Layers className="w-3 h-3 text-cyan-400" />}
                        label="Slot Expansions"
                        items={pendingSlots}
                        type="slot"
                        page={slotPage}
                        onPageChange={setSlotPage}
                        onVerify={handleVerify}
                        onReject={handleReject}
                        processingId={processingId}
                        emptyText="No pending slot purchases"
                    />
                </div>

                <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-white/10 to-transparent my-6" />

                {stats?.reconciliation && (
                    <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                        <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
                            <div>
                                <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Outstanding Rounds</div>
                                <div className="text-sm font-bold">{stats.reconciliation.outstanding_rounds}</div>
                            </div>
                            <div>
                                <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Open Rounds With Actionable Requests</div>
                                <div className="text-sm font-bold">{stats.reconciliation.open_rounds_with_actionable_requests}</div>
                            </div>
                            <div>
                                <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Closed Ready To Mark Paid</div>
                                <div className="text-sm font-bold">{stats.reconciliation.closed_rounds_ready_to_paid}</div>
                            </div>
                            <div>
                                <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Refunded Payouts</div>
                                <div className="text-sm font-bold">{stats.reconciliation.refunded_payouts || 0}</div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Payout Infrastructure */}
                <div className="space-y-6">
                    <div className="flex items-center gap-3 px-1">
                        <div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center text-yellow-500">
                            <DollarSign className="w-4 h-4" />
                        </div>
                        <div>
                            <h3 className="font-bold text-sm tracking-tight text-yellow-500">Payout Protocols</h3>
                            <p className="text-[9px] text-muted-foreground uppercase tracking-widest">Round Management</p>
                        </div>
                    </div>

                    {/* Phase 01: Closure */}
                    <div className="space-y-4">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 px-1 italic">Phase 01: Closure</div>
                        {stats?.open_rounds?.length === 0 ? (
                            <div className="text-center p-8 bg-white/5 rounded-2xl border border-dashed border-white/10 opacity-50">
                                <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50">All rounds processed</span>
                            </div>
                        ) : (
                            stats?.open_rounds?.map((round) => (
                                <Card key={round.id} className="bg-primary/5 border-primary/20 backdrop-blur-md overflow-hidden group">
                                    <CardHeader className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-2 sm:space-y-0">
                                        <div>
                                            <CardTitle className="text-sm font-bold text-primary">Round: {round.round_date}</CardTitle>
                                            <p className="text-[10px] text-muted-foreground opacity-60">ID: {round.id.slice(0, 8)}</p>
                                        </div>
                                        <div className="sm:text-right">
                                            <div className="text-lg font-bold text-white tracking-tighter">~{((Number(round.total_diamonds || 0)) * (exchangeRate || 0.1)).toFixed(2)} WLD</div>
                                            <div className="text-[8px] uppercase tracking-widest text-primary/60 font-bold">Est. Payout Pool</div>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="p-4 pt-0 space-y-4">
                                        <div className="grid grid-cols-2 gap-2 bg-black/40 p-3 rounded-xl border border-white/5">
                                            <div>
                                                <div className="text-[8px] text-muted-foreground uppercase font-bold opacity-50">Diamonds</div>
                                                <div className="text-xs font-mono text-game-diamond">{formatCompactNumber(round.total_diamonds)}</div>
                                            </div>
                                            <div>
                                                <div className="text-[8px] text-muted-foreground uppercase font-bold opacity-50">Started</div>
                                                <div className="text-xs font-mono">{new Date(round.created_at).toLocaleDateString()}</div>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    placeholder="Override Pool (Optional)"
                                                    className="bg-black/40 border-white/10 h-9 font-mono text-xs"
                                                    type="number"
                                                    value={manualPools[round.id] || ''}
                                                    onChange={(e) => setManualPools(prev => ({ ...prev, [round.id]: e.target.value }))}
                                                />
                                            </div>
                                            <Button
                                                className="w-full h-11 bg-primary hover:bg-primary/80 text-black font-bold uppercase tracking-widest text-xs rounded-xl"
                                                onClick={() => handleProcessRound(round.id)}
                                                disabled={!!processingId}
                                            >
                                                {processingId === round.id ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                                                Finalize & Distribute
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))
                        )}
                    </div>

                    {/* Phase 02: Execution */}
                    <div className="space-y-4 pt-2">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 px-1 italic">Phase 02: Execution</div>
                        {stats?.execution_rounds?.length === 0 ? (
                            <div className="text-center p-8 bg-white/5 rounded-2xl border border-dashed border-white/10 opacity-50">
                                <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50">No rounds awaiting execution</span>
                            </div>
                        ) : (
                            <>
                                {paginate(stats?.execution_rounds || [], executionPage).map((round) => (
                                    <Card key={round.id} className="bg-yellow-500/5 border-yellow-500/20 backdrop-blur-md overflow-hidden">
                                        <CardHeader className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-2 sm:space-y-0">
                                            <div>
                                                <CardTitle className="text-sm font-bold text-yellow-500">Round: {round.round_date}</CardTitle>
                                                <p className="text-[10px] text-muted-foreground opacity-60 italic">Crypto-payouts Ready</p>
                                            </div>
                                            <div className="sm:text-right">
                                                <div className="text-lg font-bold text-white tracking-tighter flex items-center justify-end gap-2">
                                                    {formatCompactNumber(round.payout_pool_wld)} WLD
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-6 w-6 p-0 hover:bg-white/10 rounded-full"
                                                        onClick={() => {
                                                            setEditRoundId(round.id);
                                                            setEditPoolValue(round.payout_pool_wld?.toString() || '');
                                                        }}
                                                    >
                                                        <Edit className="w-3 h-3 text-white/50" />
                                                    </Button>
                                                </div>
                                                <div className="text-[8px] uppercase tracking-widest text-yellow-500/60 font-bold">Payout Pool</div>
                                            </div>
                                        </CardHeader>
                                        <CardContent className="p-4 pt-0 space-y-4">
                                            <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-center">
                                                <p className="text-[10px] text-yellow-500/80 font-medium">Blockchain broadcast required. Ensure backend liquidity.</p>
                                            </div>
                                            <Button
                                                className="w-full h-11 bg-yellow-600 hover:bg-yellow-700 text-white font-bold uppercase tracking-widest text-xs rounded-xl"
                                                onClick={() => handleExecutePayouts(round.id)}
                                                disabled={!!processingId}
                                            >
                                                {processingId === round.id ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <DollarSign className="w-4 h-4 mr-2" />}
                                                Initialize Transactions
                                            </Button>
                                        </CardContent>
                                    </Card>
                                ))}
                                <AdminPagination
                                    currentPage={executionPage}
                                    totalItems={stats?.execution_rounds?.length || 0}
                                    onPageChange={setExecutionPage}
                                />
                            </>
                        )}
                    </div>
                </div>
            </div>

            <Dialog open={!!editRoundId} onOpenChange={(open) => !open && setEditRoundId(null)}>
                <DialogContent className="bg-zinc-900 border-white/10 text-white">
                    <DialogHeader>
                        <DialogTitle>Recalculate Round Pool</DialogTitle>
                        <DialogDescription>
                            Manually override the total WLD payout pool for this round. This will recalculate the WLD amount for EVERY recipient in this round.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>New Pool Amount (WLD)</Label>
                            <Input
                                type="number"
                                value={editPoolValue}
                                onChange={(e) => setEditPoolValue(e.target.value)}
                                placeholder="e.g. 500"
                                className="bg-black/40 border-white/10"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditRoundId(null)} className="border-white/10 hover:bg-white/5">Cancel</Button>
                        <Button onClick={handleRecalculate} disabled={!!processingId} className="bg-primary text-black hover:bg-primary/90">
                            {processingId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                            Recalculate
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!verifyId} onOpenChange={(open) => !open && setVerifyId(null)}>
                <DialogContent className="bg-zinc-900 border-white/10 text-white">
                    <DialogHeader>
                        <DialogTitle>Verify Transaction</DialogTitle>
                        <DialogDescription>
                            This transaction is missing a Transaction ID. You can enter one to verify against World App, or leave empty to Force Confirm (bypass verification).
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Transaction ID (Optional)</Label>
                            <Input
                                value={manualTxId}
                                onChange={(e) => setManualTxId(e.target.value)}
                                placeholder="0x..."
                                className="bg-black/40 border-white/10 font-mono text-xs"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setVerifyId(null)} className="border-white/10 hover:bg-white/5">Cancel</Button>
                        <Button onClick={confirmManualVerify} disabled={!!processingId} className="bg-primary text-black hover:bg-primary/90">
                            {processingId ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                            {manualTxId ? 'Verify & Confirm' : 'Force Confirm'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {/* Confirmation Dialog */}
            <ConfirmDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title={confirmConfig.title}
                description={confirmConfig.description}
                onConfirm={confirmConfig.onConfirm}
                variant={confirmConfig.variant}
            />
        </>
    );
};

/* ── Pending Section (with pagination) ─────────────────────────── */

interface PendingSectionProps {
    icon: React.ReactNode;
    label: string;
    items: any[];
    type: 'oil' | 'machine' | 'slot';
    page: number;
    onPageChange: (p: number) => void;
    onVerify: (type: 'oil' | 'machine' | 'slot', id: string) => void;
    onReject: (type: 'oil' | 'machine' | 'slot', id: string) => void;
    processingId: string | null;
    emptyText: string;
}

const PendingSection = ({ icon, label, items, type, page, onPageChange, onVerify, onReject, processingId, emptyText }: PendingSectionProps) => {
    const paginatedItems = paginate(items, page);

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 px-1">
                {icon}
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label} ({items.length})</span>
            </div>
            {items.length === 0 ? (
                <div className="text-center py-8 bg-white/5 rounded-2xl border border-dashed border-white/10 opacity-50">
                    <span className="text-[10px] uppercase tracking-widest">{emptyText}</span>
                </div>
            ) : (
                <>
                    <div className="grid gap-3">
                        {paginatedItems.map((tx) => (
                            <TransactionCard
                                key={tx.id}
                                tx={tx}
                                type={type}
                                onVerify={onVerify}
                                onReject={onReject}
                                processing={processingId === tx.id}
                            />
                        ))}
                    </div>
                    <AdminPagination
                        currentPage={page}
                        totalItems={items.length}
                        onPageChange={onPageChange}
                    />
                </>
            )}
        </div>
    );
};

/* ── Transaction Card ──────────────────────────────────────────── */

interface TransactionCardProps {
    tx: any;
    type: 'oil' | 'machine' | 'slot';
    onVerify: (type: 'oil' | 'machine' | 'slot', id: string) => void;
    onReject: (type: 'oil' | 'machine' | 'slot', id: string) => void;
    processing: boolean;
}

const TransactionCard = ({ tx, type, onVerify, onReject, processing }: TransactionCardProps) => (
    <Card className="bg-white/5 border-white/5 backdrop-blur-sm overflow-hidden border-l-2 border-l-primary/30 group">
        <CardContent className="p-3 sm:p-4 space-y-3">
            <div className="flex justify-between items-start gap-3">
                <div className="min-w-0 flex-1">
                    <div className="text-[8px] text-muted-foreground uppercase font-bold tracking-[0.15em] mb-1 opacity-50">Transaction</div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {type === 'oil' && <span className="text-sm font-bold text-primary">{formatCompactNumber(tx.amount_oil)} OIL</span>}
                        {type === 'machine' && <span className="text-sm font-bold text-primary uppercase">{tx.machine_type}</span>}
                        {type === 'slot' && <span className="text-sm font-bold text-primary">{tx.slots_purchased} slots</span>}
                        <span className="text-[10px] text-muted-foreground">/</span>
                        <span className="text-sm font-bold text-white">
                            {type === 'oil' ? tx.amount_token : tx.amount_wld} {type === 'oil' ? tx.token : 'WLD'}
                        </span>
                    </div>
                </div>
                <div className="text-right shrink-0">
                    <div className="text-[8px] text-muted-foreground uppercase font-bold opacity-40 mb-1">User</div>
                    <div className="text-[11px] font-bold">{tx.profiles?.player_name || 'N/A'}</div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <div className="bg-black/40 p-2 rounded-lg border border-white/5 min-w-0">
                    <div className="text-[7px] text-muted-foreground uppercase font-bold opacity-40 mb-0.5 tracking-tighter">Reference</div>
                    <div className="text-[8px] font-mono truncate opacity-80">{tx.reference || '--'}</div>
                </div>
                <div className="bg-black/40 p-2 rounded-lg border border-white/5 min-w-0">
                    <div className="text-[7px] text-muted-foreground uppercase font-bold opacity-40 mb-0.5 tracking-tighter">Identity</div>
                    <div className="text-[8px] font-mono truncate opacity-60">ID: {tx.user_id?.slice(0, 10)}...</div>
                </div>
            </div>

            <div className="flex gap-2 pt-1">
                <Button
                    size="sm"
                    className="flex-1 h-9 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 rounded-xl text-[9px] uppercase font-bold tracking-widest"
                    onClick={() => onVerify(type, tx.id)}
                    disabled={processing}
                >
                    {processing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-1.5" />}
                    Confirm
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 px-3 text-red-500/60 hover:text-red-400 hover:bg-red-500/5 rounded-xl text-[9px] uppercase font-bold tracking-widest"
                    onClick={() => onReject(type, tx.id)}
                    disabled={processing}
                >
                    Void
                </Button>
            </div>
        </CardContent>
    </Card>
);
