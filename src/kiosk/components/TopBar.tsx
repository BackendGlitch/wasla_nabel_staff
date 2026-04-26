import { useCompanyLogoUrl, useCompanyName } from '@/contexts/InitContext';
import LatencyDisplay from '@/components/LatencyDisplay';
import PrintQueueIndicator from '@/components/PrintQueueIndicator';
import PrinterStatusDisplay from '@/components/PrinterStatusDisplay';
import UsbPrinterStatus from '@/kiosk/components/UsbPrinterStatus';
import { Spacing, TouchSize, ZIndex } from '@/kiosk/tokens';

export interface TopBarProps {
  stationName?: string | null;
  isGhostMode: boolean;
  staffInfo: { firstName?: string; lastName?: string } | null;
  wsConnected: boolean;
  wsLatency?: number;
  /**
   * When true the staff machine prints via USB (POS deployment) and the
   * IP-based printer pill must be hidden. We render a USB-only health pill
   * instead. In normal/Ethernet mode we keep the legacy display so the
   * staff-app-on-normal-machine flow stays unchanged.
   */
  isPosMode: boolean;
}

/**
 * Kiosk top bar.
 *
 * Provides the operator with at-a-glance station identity + system health.
 * Unlike the legacy desktop header, the top bar is intentionally light:
 * destination switching, refresh, add-vehicle, and logout move into the
 * dedicated screens (Home, Booking, System) so each touch target stays
 * unambiguous and finger-sized.
 */
export function TopBar({
  stationName,
  isGhostMode,
  staffInfo,
  wsConnected,
  wsLatency,
  isPosMode,
}: TopBarProps) {
  const companyLogo = useCompanyLogoUrl();
  const companyName = useCompanyName();

  return (
    <header
      className={`flex items-center justify-between border-b transition-colors ${
        isGhostMode
          ? 'bg-violet-50/60 border-violet-200/60'
          : 'bg-white border-slate-200/80'
      }`}
      style={{
        height: TouchSize.navTab,
        paddingInline: Spacing.lg,
        zIndex: ZIndex.topBar,
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <img src="icons/logo.png" alt="Wasla" className="h-9 w-9 object-contain" />
        {companyLogo && (
          <>
            <div className="w-px h-7 bg-slate-200" />
            <img
              src={companyLogo}
              alt={companyName}
              className="h-9 w-9 object-contain"
            />
          </>
        )}
        <div className="w-px h-7 bg-slate-200" />
        <div className="min-w-0">
          <div className="text-base font-semibold text-slate-800 leading-tight truncate">
            {isGhostMode ? 'Mode Fantôme' : 'Station'}
          </div>
          {stationName && (
            <div className="text-xs text-slate-500 leading-tight truncate">
              {stationName}
            </div>
          )}
        </div>
        {isGhostMode && (
          <span className="ml-2 px-2 py-1 bg-violet-100 text-violet-700 rounded-md text-xs font-semibold animate-pulse">
            FANTÔME
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {isPosMode ? (
          <UsbPrinterStatus />
        ) : (
          <>
            <PrinterStatusDisplay onConfigUpdate={() => {}} />
            <PrintQueueIndicator />
            <LatencyDisplay connected={wsConnected} latency={wsLatency} compact />
          </>
        )}
        {staffInfo && (
          <>
            <div className="h-6 w-px bg-slate-200 mx-1" />
            <div
              className="rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold"
              style={{ width: 36, height: 36 }}
            >
              {(staffInfo.firstName?.[0] || '').toUpperCase()}
              {(staffInfo.lastName?.[0] || '').toUpperCase()}
            </div>
            <span className="text-sm font-medium text-slate-700 truncate max-w-[120px]">
              {staffInfo.firstName}
            </span>
          </>
        )}
      </div>
    </header>
  );
}
