import { MiniKit } from '@worldcoin/minikit-js';

export type MiniKitErrorReason = 'outside_of_worldapp' | 'app_out_of_date' | 'unknown' | 'not_ready';

export type MiniKitEnsureResult =
  | { ok: true }
  | { ok: false; reason: MiniKitErrorReason };

export const ensureMiniKit = (): MiniKitEnsureResult => {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'not_ready' };
  }

  if (MiniKit.isInstalled()) {
    return { ok: true };
  }

  // MiniKit.install() returns void — attempt install, then re-check isInstalled.
  try {
    const appId = import.meta.env.VITE_WORLD_APP_ID || undefined;
    MiniKit.install(appId);
  } catch {
    // install may throw when outside World App
  }

  if (MiniKit.isInstalled()) {
    return { ok: true };
  }

  // Distinguish between outside-World-App and other failures
  if (typeof (window as any).WorldApp === 'undefined') {
    return { ok: false, reason: 'outside_of_worldapp' };
  }

  return { ok: false, reason: 'unknown' };
};

export const getMiniKitErrorMessage = (reason: MiniKitErrorReason) => {
  switch (reason) {
    case 'outside_of_worldapp':
      return 'Open this mini app inside World App to continue.';
    case 'app_out_of_date':
      return 'Please update World App to the latest version and try again.';
    case 'not_ready':
      return 'World App is still initializing. Please try again in a moment.';
    default:
      return 'MiniKit failed to initialize. Please try again.';
  }
};
