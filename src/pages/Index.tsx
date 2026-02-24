import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameState } from '@/hooks/useGameState';
import { useSession } from '@/hooks/useSession';
import { GameHeader } from '@/components/game/GameHeader';
import { BottomNav, TabType } from '@/components/game/BottomNav';
import { MiningTab } from '@/components/game/MiningTab';
import { ShopTab } from '@/components/game/ShopTab';
import { BankTab } from '@/components/game/BankTab';
import { MarketTab } from '@/components/game/MarketTab';
import { ProfileTab } from '@/components/game/ProfileTab';
import { LeaderboardTab } from '@/components/game/LeaderboardTab';
import { HumanGate } from '@/components/game/HumanGate';
import { AdminTab } from '@/components/game/AdminTab';
import miningBg from '@/assets/mining-bg.jpg';
import { Loader2 } from 'lucide-react';

const Index = () => {
  const [activeTab, setActiveTab] = useState<TabType>('mining');
  const navigate = useNavigate();
  const { session } = useSession();

  const {
    config,
    player,
    machines,
    loading: gameLoading,
    error: gameError,
    profile,
    buyMachine,
    fuelMachine,
    startMachine,
    stopMachine,
    upgradeMachine,
    discardMachine,
    exchangeMineral,
    refresh,
    mutateState,
    buySlots,
  } = useGameState();

  useEffect(() => {
    if (!session) {
      navigate('/auth');
    }
  }, [session, navigate]);

  if (!session) {
    return null;
  }

  // Avoid "full-page reload" feeling on background sync / manual refresh.
  // Only show the blocking loader on the very first load (when we have no config yet).
  if (gameLoading && !config) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{
          backgroundImage: `linear-gradient(to bottom, hsl(120 10% 4% / 0.9), hsl(120 10% 4% / 0.95)), url(${miningBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (profile && !profile.isHumanVerified) {
    return <HumanGate onVerified={refresh} />;
  }

  const isGameReady = !!config && !gameLoading;

  return (
    <div
      className="min-h-screen max-w-md mx-auto flex flex-col relative"
      style={{
        backgroundImage: `linear-gradient(to bottom, hsl(120 10% 4% / 0.85), hsl(120 10% 4% / 0.95)), url(${miningBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
      }}
    >
      <GameHeader player={player} machines={machines} config={config} onRefresh={refresh} />

      <main className="flex-1 px-3 pb-24 overflow-y-auto">
        {gameError && (
          <div className="card-game rounded-xl p-3 text-xs text-destructive mb-3">
            {gameError}
          </div>
        )}

        {activeTab === 'mining' && config && (
          <MiningTab
            userMachines={machines}
            config={config}
            oilBalance={player.oilBalance}
            onFuel={fuelMachine}
            onStart={startMachine}
            onStop={stopMachine}
            onUpgrade={upgradeMachine}
            onDiscard={(id) => {
              console.log('Index: onDiscard triggered for:', id);
              discardMachine(id);
            }}
            maxSlots={player.maxSlots ?? 10}
            onBuySlots={buySlots}
          />
        )}

        {activeTab === 'shop' && config && (
          <ShopTab
            config={config}
            oilBalance={player.oilBalance}
            machines={machines}
            maxSlots={player.maxSlots ?? 10}
            onBuy={buyMachine}
            onBuySlots={buySlots}
          />
        )}

        {activeTab === 'market' && config && (
          <MarketTab
            config={config}
            minerals={player.minerals}
            oilBalance={player.oilBalance}
            onExchange={exchangeMineral}
          />
        )}

        {activeTab === 'bank' && config && (
          <BankTab
            oilBalance={player.oilBalance}
            diamondBalance={player.diamondBalance}
            config={config}
            defaultOil={config.pricing?.oil_per_wld ?? 1000}
            onPurchaseComplete={(newBalance) => {
              if (newBalance !== undefined) {
                mutateState(prev => ({ ...prev, oilBalance: newBalance }));
              }
              refresh(true);
            }}
            lastCashout={player.lastCashout}
          />
        )}

        {activeTab === 'leaderboard' && (
          <LeaderboardTab currentUserId={session.userId} />
        )}

        {activeTab === 'profile' && (
          <ProfileTab
            player={player}
            machines={machines}
            config={config}
            isAdmin={Boolean(profile?.isAdmin)}
            playerName={profile?.playerName || 'Miner'}
            referralCode={profile?.referralCode || undefined}
            referralCount={profile?.referralCount || 0}
          />
        )}

        {activeTab === 'admin' && profile?.isAdmin && (
          <AdminTab config={config} />
        )}
      </main>

      <BottomNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        machineCount={machines.length}
        isGameReady={isGameReady}
        isAdmin={Boolean(profile?.isAdmin)}
      />
    </div>
  );
};

export default Index;
