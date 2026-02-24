import { Pickaxe, ShoppingBag, TrendingUp, User, Crown, Wallet, CreditCard } from 'lucide-react';

export type TabType = 'mining' | 'shop' | 'market' | 'bank' | 'leaderboard' | 'profile' | 'admin';

interface BottomNavProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  machineCount: number;
  isGameReady?: boolean;
  isAdmin?: boolean;
}

export const BottomNav = ({ activeTab, onTabChange, machineCount, isGameReady = true, isAdmin = false }: BottomNavProps) => {
  const tabs = [
    { id: 'mining' as TabType, icon: Pickaxe, label: 'Mining', badge: machineCount > 0 ? machineCount : undefined },
    { id: 'shop' as TabType, icon: ShoppingBag, label: 'Shop' },
    { id: 'market' as TabType, icon: TrendingUp, label: 'Market' },
    { id: 'bank' as TabType, icon: Wallet, label: 'Bank' },
    { id: 'leaderboard' as TabType, icon: Crown, label: 'Ranks' },
    { id: 'profile' as TabType, icon: User, label: 'Profile' },
  ];

  if (isAdmin) {
    tabs.push({ id: 'admin' as TabType, icon: CreditCard, label: 'Game Master' });
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50">
      <div className="max-w-md mx-auto">
        <div className="bg-card/95 backdrop-blur-lg border-t border-border mx-2 mb-2 rounded-2xl">
          <div className="flex items-center justify-around py-2">
            {tabs.map(tab => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;

              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  disabled={!isGameReady}
                  className={`relative flex flex-col items-center gap-0.5 px-2 py-2 rounded-xl transition-all duration-200 ${isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                    } ${!isGameReady ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isActive && (
                    <div className="absolute inset-0 bg-primary/10 rounded-xl glow-green" />
                  )}
                  <div className="relative">
                    <Icon className={`w-4 h-4 ${isActive ? 'animate-float' : ''}`} />
                    {tab.badge && (
                      <span className="absolute -top-1 -right-2 w-4 h-4 bg-primary text-primary-foreground rounded-full text-[10px] font-bold flex items-center justify-center">
                        {tab.badge}
                      </span>
                    )}
                  </div>
                  <span className={`text-[9px] font-medium ${isActive ? 'font-bold' : ''}`}>
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
};
