import { PropsWithChildren } from 'react';
import { MiniKitProvider as OfficialMiniKitProvider } from '@worldcoin/minikit-js/minikit-provider';

export const MiniKitProvider = ({ children }: PropsWithChildren) => {
  const appId = import.meta.env.VITE_WORLD_APP_ID || undefined;

  return (
    <OfficialMiniKitProvider appId={appId}>
      {children}
    </OfficialMiniKitProvider>
  );
};
