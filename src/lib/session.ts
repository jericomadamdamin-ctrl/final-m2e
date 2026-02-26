export interface AppSession {
  token: string;
  userId: string;
  playerName?: string;
  isAdmin?: boolean;
  isHumanVerified?: boolean;
}

const STORAGE_KEY = 'mine_to_earn_session';
const COOKIE_KEY = 'm2e_sess';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days
const SESSION_EVENT = 'mine_to_earn_session_change';

const notifySessionChange = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SESSION_EVENT));
};

function setCookie(value: string) {
  try {
    document.cookie = `${COOKIE_KEY}=${encodeURIComponent(value)};path=/;max-age=${COOKIE_MAX_AGE};SameSite=Lax`;
  } catch { /* cookie write may fail in some contexts */ }
}

function getCookie(): string | null {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_KEY}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function deleteCookie() {
  try {
    document.cookie = `${COOKIE_KEY}=;path=/;max-age=0`;
  } catch { /* ignore */ }
}

export const getSession = (): AppSession | null => {
  if (typeof window === 'undefined') return null;

  // Try localStorage first (fastest)
  let raw = localStorage.getItem(STORAGE_KEY);

  // Fall back to cookie if localStorage is empty (World App webview clears localStorage)
  if (!raw) {
    raw = getCookie();
    // Re-hydrate localStorage from cookie so subsequent reads are fast
    if (raw) {
      try { localStorage.setItem(STORAGE_KEY, raw); } catch { /* quota */ }
    }
  }

  if (!raw) return null;
  try {
    return JSON.parse(raw) as AppSession;
  } catch {
    return null;
  }
};

export const setSession = (session: AppSession) => {
  const json = JSON.stringify(session);
  try { localStorage.setItem(STORAGE_KEY, json); } catch { /* quota */ }
  setCookie(json);
  notifySessionChange();
};

export const clearSession = () => {
  localStorage.removeItem(STORAGE_KEY);
  deleteCookie();
  notifySessionChange();
};

export const getSessionToken = () => getSession()?.token || null;

export const onSessionChange = (handler: () => void) => {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(SESSION_EVENT, handler);
  return () => window.removeEventListener(SESSION_EVENT, handler);
};
