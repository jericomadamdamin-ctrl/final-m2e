import { useCallback, useEffect, useState } from 'react';
import { AppSession, clearSession as clearStoredSession, getSession, onSessionChange, setSession as storeSession } from '@/lib/session';

export const useSession = () => {
  const [session, setSessionState] = useState<AppSession | null>(() => getSession());

  useEffect(() => {
    return onSessionChange(() => setSessionState(getSession()));
  }, []);

  const setSession = useCallback((next: AppSession) => {
    storeSession(next);
    setSessionState(next);
}, []);

  const clearSession = useCallback(() => {
    clearStoredSession();
  }, []);

  return { session, setSession, clearSession };
};
