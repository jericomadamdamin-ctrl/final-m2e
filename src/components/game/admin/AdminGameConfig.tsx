import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { fetchTable, updateTableRow, updateGlobalSetting, updateConfig } from '@/lib/backend';
import { Settings, Loader2, Save, Layers, Droplets, Gem, Globe, Zap, Cpu } from 'lucide-react';
import { GameConfig } from '@/types/game';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { cn } from '@/lib/utils';

interface AdminGameConfigProps {
    accessKey: string;
    config: GameConfig | null;
}

export const AdminGameConfig = ({ accessKey, config }: AdminGameConfigProps) => {
    return (
        <div className="animate-fade-in px-1 space-y-4">
            <Accordion type="multiple" defaultValue={['live-config']} className="space-y-4">
                {/* Section 1: Live Game Config (Cached) */}
                <AccordionItem value="live-config" className="border-none">
                    <AccordionTrigger className="hover:no-underline p-0">
                        <SectionHeader icon={<Zap className="w-4 h-4" />} title="Primary Calibration" subtitle="Static & Cached Pricing" />
                    </AccordionTrigger>
                    <AccordionContent className="pt-4">
                        {config && <ConfigEditor config={config} accessKey={accessKey} />}
                    </AccordionContent>
                </AccordionItem>

                {/* Section 2: Machine Tiers */}
                <AccordionItem value="machines" className="border-none">
                    <AccordionTrigger className="hover:no-underline p-0">
                        <SectionHeader icon={<Cpu className="w-4 h-4" />} title="Machine Matrix" subtitle="Tiers & Performance" />
                    </AccordionTrigger>
                    <AccordionContent className="pt-4">
                        <MachineTiersEditor accessKey={accessKey} />
                    </AccordionContent>
                </AccordionItem>

                {/* Section 3: Mineral Configs */}
                <AccordionItem value="minerals" className="border-none">
                    <AccordionTrigger className="hover:no-underline p-0">
                        <SectionHeader icon={<Gem className="w-4 h-4" />} title="Resource Rarity" subtitle="Drop Rates & Values" />
                    </AccordionTrigger>
                    <AccordionContent className="pt-4">
                        <MineralConfigsEditor accessKey={accessKey} />
                    </AccordionContent>
                </AccordionItem>

                {/* Section 4: Global Game Settings */}
                <AccordionItem value="economy" className="border-none">
                    <AccordionTrigger className="hover:no-underline p-0">
                        <SectionHeader icon={<Globe className="w-4 h-4" />} title="Global Economy" subtitle="Dynamic Rules & Multipliers" />
                    </AccordionTrigger>
                    <AccordionContent className="pt-4">
                        <GlobalSettings accessKey={accessKey} />
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </div>
    );
};

const SectionHeader = ({ icon, title, subtitle }: { icon: React.ReactNode, title: string, subtitle: string }) => (
    <div className="flex items-center gap-3 w-full text-left bg-white/5 p-4 rounded-2xl border border-white/5 group-data-[state=open]:border-primary/20 transition-all">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-data-[state=open]:bg-primary group-data-[state=open]:text-black transition-all">
            {icon}
        </div>
        <div>
            <h3 className="font-bold text-sm tracking-tight">{title}</h3>
            <p className="text-[9px] text-muted-foreground uppercase tracking-widest">{subtitle}</p>
        </div>
    </div>
);

const MachineTiersEditor = ({ accessKey }: { accessKey: string }) => {
    const { toast } = useToast();
    const [tiers, setTiers] = useState<any[]>([]);

    const loadTiers = async () => {
        try {
            const data = await fetchTable('machine_tiers', accessKey);
            setTiers(data.sort((a: any, b: any) => a.cost_wld - b.cost_wld));
        } catch (err) { console.error(err); }
    };

    useEffect(() => { loadTiers(); }, []);

    const handleUpdate = async (id: string, updates: any) => {
        try {
            await updateTableRow('machine_tiers', id, updates, accessKey);
            toast({ title: 'Config Updated', description: `Saved for ${id}`, className: 'glow-green' });
            await loadTiers();
        } catch (err: any) {
            toast({ title: 'Update Failed', description: err.message, variant: 'destructive' });
        }
    };

    return (
        <div className="grid gap-4">
            {tiers.map((tier) => (
                <Card key={tier.id} className="bg-white/5 border-white/5 backdrop-blur-md overflow-hidden">
                    <div className="p-3 bg-white/5 flex justify-between items-center border-b border-white/5">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-primary">{tier.name || tier.id}</span>
                        <span className="text-[9px] font-mono opacity-40">{tier.id}</span>
                    </div>
                    <CardContent className="p-4 grid grid-cols-2 gap-4">
                        <EditorField label="WLD Cost" defaultValue={tier.cost_wld} onSave={(val) => handleUpdate(tier.id, { cost_wld: val })} />
                        <EditorField label="Actions/Hr" defaultValue={tier.speed_actions_per_hour} onSave={(val) => handleUpdate(tier.id, { speed_actions_per_hour: val })} />
                        <EditorField label="Fuel/Hr" defaultValue={tier.oil_burn_per_hour} onSave={(val) => handleUpdate(tier.id, { oil_burn_per_hour: val })} />
                        <EditorField label="Capacity" defaultValue={tier.tank_capacity} onSave={(val) => handleUpdate(tier.id, { tank_capacity: val })} />
                    </CardContent>
                </Card>
            ))}
        </div>
    );
};

const MineralConfigsEditor = ({ accessKey }: { accessKey: string }) => {
    const { toast } = useToast();
    const [minerals, setMinerals] = useState<any[]>([]);

    const loadMinerals = async () => {
        try {
            const data = await fetchTable('mineral_configs', accessKey);
            setMinerals(data.sort((a: any, b: any) => a.oil_value - b.oil_value));
        } catch (err) { console.error(err); }
    };

    useEffect(() => { loadMinerals(); }, []);

    const handleUpdate = async (id: string, updates: any) => {
        try {
            await updateTableRow('mineral_configs', id, updates, accessKey);
            toast({ title: 'Mineral Updated', description: `Saved for ${id}`, className: 'glow-green' });
            await loadMinerals();
        } catch (err: any) {
            toast({ title: 'Update Failed', description: err.message, variant: 'destructive' });
        }
    };

    return (
        <div className="grid grid-cols-1 gap-3">
            {minerals.map((m) => (
                <Card key={m.id} className="bg-white/5 border-white/5 backdrop-blur-md">
                    <CardContent className="p-4 py-3 flex items-center justify-between gap-4">
                        <div className="flex-1">
                            <h4 className="text-[11px] font-bold uppercase tracking-wider">{m.name || m.id}</h4>
                        </div>
                        <div className="flex items-center gap-3 w-48">
                            <EditorField label="Value" defaultValue={m.oil_value} onSave={(val) => handleUpdate(m.id, { oil_value: val })} compact />
                            <EditorField label="Rate" defaultValue={m.drop_rate} onSave={(val) => handleUpdate(m.id, { drop_rate: val })} compact />
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
};

const GlobalSettings = ({ accessKey }: { accessKey: string }) => {
    const { toast } = useToast();
    const [settings, setSettings] = useState<any[]>([]);

    const loadSettings = async () => {
        try {
            const data = await fetchTable('global_game_settings', accessKey);
            setSettings(data);
        } catch (err) { console.error(err); }
    };

    useEffect(() => { loadSettings(); }, []);

    const handleUpdate = async (key: string, value: number) => {
        try {
            await updateGlobalSetting(key, value, accessKey);
            toast({ title: 'Variable Updated', description: `${key} persistent.`, className: 'glow-green' });
            await loadSettings();
        } catch (err: any) {
            toast({ title: 'Write Access Denied', description: err.message, variant: 'destructive' });
        }
    };

    return (
        <div className="grid gap-3">
            {settings.map((s) => (
                <Card key={s.key} className="bg-white/5 border-white/5 backdrop-blur-md overflow-hidden">
                    <CardContent className="p-4 py-3 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                            <div className="text-[10px] font-bold uppercase text-primary/80">{s.key.replace(/_/g, ' ')}</div>
                            <div className="text-[9px] opacity-40 italic truncate max-w-[150px]">{s.description}</div>
                        </div>
                        <div className="w-24">
                            <Input
                                type="number"
                                defaultValue={s.value}
                                onBlur={(e) => handleUpdate(s.key, parseFloat(e.target.value))}
                                className="h-9 bg-black/40 border-white/10 text-right font-mono text-xs rounded-xl"
                            />
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
};

const ConfigEditor = ({ config, accessKey }: { config: GameConfig, accessKey: string }) => {
    const { toast } = useToast();
    const [oilPerWld, setOilPerWld] = useState(config?.pricing.oil_per_wld || 0);
    const [oilPerUsdc, setOilPerUsdc] = useState(config?.pricing.oil_per_usdc || 0);
    const [diamondDrop, setDiamondDrop] = useState(config?.mining.action_rewards.diamond.drop_rate_per_action || 0);
    const [dailyDiamondCap, setDailyDiamondCap] = useState(config?.diamond_controls.daily_cap_per_user || 0);
    const [treasuryPct, setTreasuryPct] = useState(config?.treasury.payout_percentage || 0);
    const [cashoutCooldown, setCashoutCooldown] = useState(config?.cashout.cooldown_days || 0);
    const [cashoutTaxPct, setCashoutTaxPct] = useState(config?.cashout.tax_rate_percent ?? 30);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!config) return;
        setOilPerWld(config.pricing.oil_per_wld);
        setOilPerUsdc(config.pricing.oil_per_usdc);
        setDiamondDrop(config.mining.action_rewards.diamond.drop_rate_per_action);
        setDailyDiamondCap(config.diamond_controls.daily_cap_per_user);
        setTreasuryPct(config.treasury.payout_percentage);
        setCashoutCooldown(config.cashout.cooldown_days);
        setCashoutTaxPct(config.cashout.tax_rate_percent ?? 30);
    }, [config]);

    const handleSave = async () => {
        setSaving(true);
        try {
            await updateConfig({
                'pricing.oil_per_wld': oilPerWld,
                'pricing.oil_per_usdc': oilPerUsdc,
                'mining.action_rewards.diamond.drop_rate_per_action': diamondDrop,
                'diamond_controls.daily_cap_per_user': dailyDiamondCap,
                'treasury.payout_percentage': treasuryPct,
                'cashout.cooldown_days': cashoutCooldown,
                'cashout.tax_rate_percent': cashoutTaxPct,
            });
            toast({ title: 'Matrix Recalibrated', description: 'Central config updated successfully.' });
        } catch (err: any) {
            toast({ title: 'Calibration Failed', description: err.message, variant: 'destructive' });
        } finally { setSaving(false); }
    };

    return (
        <Card className="bg-primary/5 border-primary/20 backdrop-blur-md overflow-hidden">
            <CardContent className="p-4 space-y-4 pt-6">
                <div className="grid grid-cols-2 gap-4">
                    <EditorField label="OIL / WLD" value={oilPerWld} onChange={(v) => setOilPerWld(Number(v))} />
                    <EditorField label="OIL / USDC" value={oilPerUsdc} onChange={(v) => setOilPerUsdc(Number(v))} />
                    <EditorField label="Diamond Drop" value={diamondDrop} onChange={(v) => setDiamondDrop(Number(v))} />
                    <EditorField label="Daily Cap" value={dailyDiamondCap} onChange={(v) => setDailyDiamondCap(Number(v))} />
                    <EditorField label="Treasury %" value={treasuryPct} onChange={(v) => setTreasuryPct(Number(v))} />
                    <EditorField label="Cooldown (D)" value={cashoutCooldown} onChange={(v) => setCashoutCooldown(Number(v))} />
                    <EditorField label="Cashout Tax %" value={cashoutTaxPct} onChange={(v) => setCashoutTaxPct(Number(v))} />
                </div>
                <Button className="w-full h-11 bg-primary hover:bg-primary/80 text-black font-bold uppercase tracking-widest text-xs rounded-xl mt-2" onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                    Broadcast Config
                </Button>
            </CardContent>
        </Card>
    );
};

const EditorField = ({ label, value, defaultValue, onChange, onSave, compact }: any) => (
    <div className="space-y-1 w-full">
        <label className={cn("text-muted-foreground font-bold uppercase tracking-tighter block", compact ? "text-[8px]" : "text-[9px]")}>{label}</label>
        <Input
            type="number"
            value={value}
            defaultValue={defaultValue}
            onChange={onChange ? (e) => onChange(e.target.value) : undefined}
            onBlur={onSave ? (e) => onSave(parseFloat(e.target.value)) : undefined}
            className={cn("bg-black/40 border-white/5 font-mono text-xs rounded-lg focus:border-primary/30", compact ? "h-8" : "h-9")}
        />
    </div>
);
