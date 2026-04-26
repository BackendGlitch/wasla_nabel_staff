import { useEffect, useMemo } from 'react';
import { logout as apiLogout, setOnAuthLogout } from '@/api/client';
import { useStation } from '@/contexts/StationContext';
import { useCompanyLogoUrl, useCompanyName, useStationName } from '@/contexts/InitContext';
import { getMachineInfoSync, isPosMode } from '@/services/machineMode';
import { printerService } from '@/services/printerService';

import { useNotifications } from './state/useNotifications';
import { useKioskNav } from './state/useKioskNav';
import { useStationData } from './state/useStationData';
import { usePosWorkflow } from './state/usePosWorkflow';

import { TopBar } from './components/TopBar';
import { BottomNav } from './components/BottomNav';
import { Toast } from './components/Toast';

import { HomeScreen } from './screens/HomeScreen';
import { BookingScreen } from './screens/BookingScreen';
import { GhostScreen } from './screens/GhostScreen';
import { SystemScreen } from './screens/SystemScreen';

/**
 * Kiosk shell — composition root for the POS-friendly UI.
 *
 * Responsibilities:
 *   - Owns the four kiosk hooks (`useNotifications`, `useStationData`,
 *     `usePosWorkflow`, `useKioskNav`) so every screen reads from the same
 *     instance.
 *   - Renders the persistent chrome (TopBar + BottomNav + Toast) and swaps
 *     the active screen based on `nav.screen`.
 *   - Mirrors the side-effects from the legacy `MainPage`: pushing company
 *     branding to the printer service and surfacing 401-driven logouts.
 *
 * KioskShell is now the production-default staff surface. Legacy MainPage is
 * retained behind a guarded fallback flag at the App level for safe cutover.
 */
export function KioskShell() {
  const { selectedStation, servedDestinationIds, setShowStationSelection } = useStation();
  const stationName = useStationName();
  const companyName = useCompanyName();
  const companyLogo = useCompanyLogoUrl();

  const { notification, showNotification } = useNotifications();
  const station = useStationData({
    selectedStation,
    servedDestinationIds,
    showNotification,
  });
  const workflow = usePosWorkflow({ station, showNotification });
  const nav = useKioskNav();

  const machineInfo = useMemo(() => getMachineInfoSync(), []);
  const posMode = useMemo(() => isPosMode(), []);

  // Push company branding to the printer service exactly like the legacy
  // MainPage does — keeps printed talons consistent regardless of which UI
  // surface is active.
  useEffect(() => {
    if (companyLogo || companyName) {
      printerService.setBranding(companyName, companyLogo);
    }
  }, [companyLogo, companyName]);

  // Mirror the legacy 401 handler so a session expiry surfaces a toast and
  // bounces the operator back to login. We intentionally re-register on every
  // mount to keep ownership of the slot while the kiosk shell is active.
  useEffect(() => {
    setOnAuthLogout((reason) => {
      const msg =
        reason === 'expired'
          ? 'Votre session a expiré. Veuillez vous reconnecter.'
          : 'Votre session a été fermée. Veuillez vous reconnecter.';
      showNotification(msg, 'error');
      try {
        window.localStorage.removeItem('authToken');
        window.localStorage.removeItem('staffInfo');
        window.localStorage.removeItem('selectedVehicleForBooking');
      } catch {
        // ignore — reload still rescues us
      }
      window.setTimeout(() => window.location.reload(), 1500);
    });
    return () => {
      setOnAuthLogout(null);
    };
  }, [showNotification]);

  useEffect(() => {
    if (nav.screen === 'ghost') {
      if (!workflow.isGhostMode) void workflow.handleEnterGhostMode();
      return;
    }
    if (workflow.isGhostMode) {
      workflow.handleExitGhostMode();
    }
  }, [nav.screen, workflow]);

  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName.toLowerCase();
      const editable = el.getAttribute('contenteditable');
      return tag === 'input' || tag === 'textarea' || tag === 'select' || editable === '' || editable === 'true';
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      if (e.key === 'F6') {
        e.preventDefault();
        workflow.setAddVehicleModalOpen(true);
        if (nav.screen !== 'booking') nav.goBooking();
        return;
      }

      if (e.key === 'Escape') {
        if (workflow.addVehicleModalOpen) {
          e.preventDefault();
          workflow.setAddVehicleModalOpen(false);
          return;
        }
      }

      const azertyMap: Record<string, number> = { a: 0, z: 1, e: 2, r: 3, t: 4, y: 5 };
      const keyLower = e.key.toLowerCase();
      if (azertyMap[keyLower] !== undefined) {
        const idx = azertyMap[keyLower];
        if (workflow.isGhostMode || nav.screen === 'ghost') {
          if (station.allDestinations[idx]) {
            e.preventDefault();
            workflow.handleGhostDestinationSelect(station.allDestinations[idx]);
          }
        } else if (station.summaries[idx]) {
          e.preventDefault();
          const s = station.summaries[idx];
          station.setSelected(s);
          station.setQueue([]);
          workflow.setSelectedVehicleForBooking(null);
          workflow.setSelectedSeats([]);
          workflow.saveSelectedVehicle(null);
          station.setLoading(false);
          nav.goBooking(s.destinationId);
        }
        return;
      }

      if (e.code && e.code.startsWith('Numpad')) {
        const digit = Number(e.key);
        if (!Number.isNaN(digit) && digit > 0 && digit < 10) {
          if ((workflow.isGhostMode || nav.screen === 'ghost') && workflow.selectedGhostDestination) {
            e.preventDefault();
            const seatCount = Math.min(digit, 8);
            workflow.setSelectedSeats(Array.from({ length: seatCount }, (_, i) => i + 1));
          } else if (station.selected) {
            e.preventDefault();
            const available = workflow.selectedVehicleForBooking
              ? (workflow.selectedVehicleForBooking.availableSeats ?? 0)
              : (station.selected.availableSeats ?? 0);
            const seatCount = Math.min(digit, Math.max(0, available));
            if (seatCount > 0) {
              workflow.setSelectedSeats(Array.from({ length: seatCount }, (_, i) => i + 1));
            }
          }
        }
        return;
      }

      if (e.code === 'Space' || e.key === ' ') {
        if (workflow.bookingLoading) {
          e.preventDefault();
          return;
        }
        if ((workflow.isGhostMode || nav.screen === 'ghost') && workflow.selectedGhostDestination && workflow.selectedSeats.length > 0) {
          e.preventDefault();
          void workflow.handleGhostBooking();
        } else if (station.selected && workflow.selectedSeats.length > 0) {
          e.preventDefault();
          void workflow.handleConfirmBooking();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    workflow.addVehicleModalOpen,
    station.summaries,
    station.selected,
    workflow.selectedVehicleForBooking,
    workflow.selectedSeats,
    workflow.isGhostMode,
    workflow.selectedGhostDestination,
    workflow.bookingLoading,
    station.allDestinations,
    nav.screen,
  ]);

  const handleLogout = async () => {
    try {
      await apiLogout();
    } catch {
      try {
        window.localStorage.removeItem('authToken');
        window.localStorage.removeItem('staffInfo');
        window.localStorage.removeItem('selectedVehicleForBooking');
      } catch {
        // ignore — reload still rescues us
      }
      window.location.reload();
    }
  };

  const isGhostMode = workflow.isGhostMode || nav.screen === 'ghost';

  return (
    <div
      className={`w-full h-screen overflow-hidden flex flex-col transition-colors ${
        isGhostMode ? 'bg-violet-50/30' : 'bg-[hsl(220,20%,98%)]'
      }`}
    >
      <TopBar
        stationName={stationName || selectedStation?.name}
        isGhostMode={isGhostMode}
        staffInfo={workflow.staffInfo}
        wsConnected={station.wsConnected}
        wsLatency={station.wsLatency}
        isPosMode={posMode}
      />

      <main className="flex-1 min-h-0 overflow-hidden">
        {nav.screen === 'home' && (
          <HomeScreen station={station} workflow={workflow} nav={nav} />
        )}
        {nav.screen === 'booking' && (
          <BookingScreen
            station={station}
            workflow={workflow}
            nav={nav}
            showNotification={showNotification}
          />
        )}
        {nav.screen === 'ghost' && (
          <GhostScreen station={station} workflow={workflow} />
        )}
        {nav.screen === 'system' && (
          <SystemScreen
            staffInfo={workflow.staffInfo}
            stationName={stationName || selectedStation?.name}
            isPosMode={posMode}
            machineId={machineInfo.machineId}
            onOpenStation={() => setShowStationSelection(true)}
            onOpenAddVehicle={() => workflow.setAddVehicleModalOpen(true)}
            onLogout={handleLogout}
          />
        )}
      </main>

      <BottomNav
        nav={nav}
        isGhostMode={isGhostMode}
        badges={{ booking: station.queue.length }}
      />

      <Toast notification={notification} />
    </div>
  );
}

export default KioskShell;
