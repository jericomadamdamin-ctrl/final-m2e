export interface AppSession {
  token: string;
  userId: string;
  playerName?: string;
  isAdmin?: boolean;
  isHumanVerified?: boolean;
}

const STORAGE_KEY = 'mine_to_earn_session';
const SESSION_EVENT = 'mine_to_earn_session_change';

const notifySessionChange = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SESSION_EVENT));
};

export const getSession = (): AppSession | null => {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AppSession;
  } catch {
    return null;
  }
};

export const setSession = (session: AppSession) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  notifySessionChange();
};

export const clearSession = () => {
  localStorage.removeItem(STORAGE_KEY);
  notifySessionChange();
};

export const getSessionToken = () => getSession()?.token || null;

export const onSessionChange = (handler: () => void) => {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(SESSION_EVENT, handler);
  return () => window.removeEventListener(SESSION_EVENT, handler);
};
