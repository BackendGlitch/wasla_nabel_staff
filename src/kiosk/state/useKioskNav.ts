import { useCallback, useState } from 'react';

/**
 * Kiosk top-level navigation state.
 *
 * The kiosk has four screens reachable from a bottom tab bar; this hook owns
 * the active screen + the optional contextual destination chosen on the home
 * screen.
 *
 * Step 1 only declares the hook so the import surface is stable for Step 2
 * (KioskShell + tabs). The legacy `MainPage.tsx` does not consume it yet.
 */
export type KioskScreen = 'home' | 'booking' | 'ghost' | 'system';

export interface UseKioskNavOptions {
  /** Initial screen rendered on first mount. Defaults to 'home'. */
  initialScreen?: KioskScreen;
}

export function useKioskNav(opts: UseKioskNavOptions = {}) {
  const [screen, setScreen] = useState<KioskScreen>(opts.initialScreen ?? 'home');
  const [selectedDestinationId, setSelectedDestinationId] = useState<string | null>(null);

  const goHome = useCallback(() => setScreen('home'), []);
  const goBooking = useCallback((destinationId?: string) => {
    if (destinationId !== undefined) setSelectedDestinationId(destinationId);
    setScreen('booking');
  }, []);
  const goGhost = useCallback(() => setScreen('ghost'), []);
  const goSystem = useCallback(() => setScreen('system'), []);

  return {
    screen,
    setScreen,
    selectedDestinationId,
    setSelectedDestinationId,
    goHome,
    goBooking,
    goGhost,
    goSystem,
  };
}

export type UseKioskNav = ReturnType<typeof useKioskNav>;
