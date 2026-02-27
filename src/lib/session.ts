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

const IDB_NAME = 'm2e_session';
const IDB_STORE = 'session';
const IDB_KEY = 'app_session';

let idbRestoreAttempted = false;

const notifySessionChange = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SESSION_EVENT));
};

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result);
    r.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
  });
}

async function getIdbSession(): Promise<string | null> {
  try {
    const db = await openIdb();
    return await new Promise<string | null>((resolve) => {
      const t = db.transaction(IDB_STORE, 'readonly');
      const req = t.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function setIdbSession(value: string): Promise<void> {
  try {
    const db = await openIdb();
    const t = db.transaction(IDB_STORE, 'readwrite');
    t.objectStore(IDB_STORE).put(value, IDB_KEY);
  } catch {
    /* no-op */
  }
}

function clearIdbSession(): void {
  try {
    indexedDB.deleteDatabase(IDB_NAME);
  } catch {
    /* no-op */
  }
}

function setCookie(value: string) {
  try {
    const secure =
      typeof window !== 'undefined' && window.location?.protocol === 'https:';
    document.cookie = `${COOKIE_KEY}=${encodeURIComponent(value)};path=/;max-age=${COOKIE_MAX_AGE};SameSite=Lax${secure ? ';Secure' : ''}`;
  } catch {
    /* cookie write may fail in some contexts */
  }
}

function getCookie(): string | null {
  try {
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${COOKIE_KEY}=([^;]*)`)
    );
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function deleteCookie() {
  try {
    document.cookie = `${COOKIE_KEY}=;path=/;max-age=0`;
  } catch {
    /* ignore */
  }
}

function isValidSession(obj: unknown): obj is AppSession {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof (obj as AppSession).token === 'string' &&
    typeof (obj as AppSession).userId === 'string'
  );
}

function tryRestoreFromIdb() {
  if (idbRestoreAttempted || typeof window === 'undefined') return;
  idbRestoreAttempted = true;

  getIdbSession().then((raw) => {
    if (!raw) return;
    try {
      const obj = JSON.parse(raw) as unknown;
      if (!isValidSession(obj)) return;

      const json = JSON.stringify(obj);
      try {
        localStorage.setItem(STORAGE_KEY, json);
      } catch {
        /* quota */
      }
      setCookie(json);
      notifySessionChange();
    } catch {
      /* invalid data, ignore */
    }
  });
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
      try {
        localStorage.setItem(STORAGE_KEY, raw);
      } catch {
        /* quota */
      }
    }
  }

  if (!raw) {
    tryRestoreFromIdb();
    return null;
  }

  try {
    return JSON.parse(raw) as AppSession;
  } catch {
    return null;
  }
};

export const setSession = (session: AppSession) => {
  const json = JSON.stringify(session);
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    /* quota */
  }
  setCookie(json);
  setIdbSession(json); // fire-and-forget
  notifySessionChange();
};

export const clearSession = () => {
  localStorage.removeItem(STORAGE_KEY);
  deleteCookie();
  clearIdbSession();
  notifySessionChange();
};

export const getSessionToken = () => getSession()?.token || null;

export const onSessionChange = (handler: () => void) => {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(SESSION_EVENT, handler);
  return () => window.removeEventListener(SESSION_EVENT, handler);
};

// Defensive sync when app is backgrounded (maximize persistence before webview may be killed)
if (typeof window !== 'undefined') {
  const flushSession = () => {
    const s = getSession();
    if (s) setSession(s);
  };
  window.addEventListener('pagehide', flushSession);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSession();
  });
}
