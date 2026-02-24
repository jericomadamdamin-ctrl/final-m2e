
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { MiniKit } from '@worldcoin/minikit-js';

interface MiniAppGuardProps {
    children: React.ReactNode;
}

export const MiniAppGuard = ({ children }: MiniAppGuardProps) => {
    const [isAllowed, setIsAllowed] = useState(false);
    const [checking, setChecking] = useState(true);

    useEffect(() => {
        const isDev = import.meta.env.DEV;
        const isMiniKit = MiniKit.isInstalled();

        if (isDev || isMiniKit) {
            setIsAllowed(true);
        } else {
            setIsAllowed(false);
        }
        setChecking(false);
    }, []);

    if (checking) {
        return null; // Or a loading spinner
    }

    if (!isAllowed) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-black text-white">
                <AlertTriangle className="w-16 h-16 text-yellow-500 mb-6" />
                <h1 className="text-2xl font-bold mb-4 font-pixel text-primary text-glow">
                    Access Restricted
                </h1>
                <p className="text-gray-400 max-w-sm mb-8">
                    This application is only accessible within the World App (MiniKit environment).
                </p>
                <div className="text-xs text-gray-600 font-mono">
                    ERR_ENV_RESTRICTED
                </div>
            </div>
        );
    }

    return <>{children}</>;
};
