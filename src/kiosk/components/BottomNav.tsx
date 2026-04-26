import type { ReactNode } from 'react';
import { TouchSize, ZIndex } from '@/kiosk/tokens';
import type { KioskScreen, UseKioskNav } from '@/kiosk/state/useKioskNav';

interface NavItem {
  id: KioskScreen;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'home',
    label: 'Accueil',
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 12l9-9 9 9M5 10v10h4v-6h6v6h4V10"
        />
      </svg>
    ),
  },
  {
    id: 'booking',
    label: 'Réservation',
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5 17h2m10 0h2M5 11l1.5-4.5A2 2 0 018.4 5h7.2a2 2 0 011.9 1.5L19 11M3 17h18v-4a2 2 0 00-2-2H5a2 2 0 00-2 2z"
        />
      </svg>
    ),
  },
  {
    id: 'ghost',
    label: 'Fantôme',
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
        />
      </svg>
    ),
  },
  {
    id: 'system',
    label: 'Système',
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

interface BottomNavProps {
  nav: UseKioskNav;
  isGhostMode?: boolean;
  /**
   * Optional badge counts (e.g. queue length on Booking tab) — Step 4 will
   * populate these. Step 2 leaves them undefined.
   */
  badges?: Partial<Record<KioskScreen, number>>;
}

/**
 * Fixed bottom navigation bar with four large touch targets.
 *
 * Each tab is `TouchSize.navTab` tall (72px) — comfortably above the 56px
 * minimum, so the operator can hit any tab confidently from a standing
 * position. Active state is visually unambiguous: filled icon + bold label +
 * top accent bar.
 */
export function BottomNav({ nav, isGhostMode = false, badges }: BottomNavProps) {
  return (
    <nav
      className={`grid grid-cols-4 border-t bg-white ${
        isGhostMode ? 'border-violet-200/60' : 'border-slate-200'
      }`}
      style={{ height: TouchSize.navTab, zIndex: ZIndex.bottomNav }}
      aria-label="Navigation kiosque"
    >
      {NAV_ITEMS.map((item) => {
        const active = nav.screen === item.id;
        const badge = badges?.[item.id];
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => nav.setScreen(item.id)}
            className={`relative flex flex-col items-center justify-center gap-0.5 transition-colors ${
              active
                ? item.id === 'ghost'
                  ? 'text-violet-700 bg-violet-50'
                  : 'text-blue-700 bg-blue-50'
                : 'text-slate-500 hover:bg-slate-50'
            }`}
            aria-current={active ? 'page' : undefined}
            aria-label={item.label}
          >
            {active && (
              <span
                className={`absolute top-0 inset-x-6 h-[3px] rounded-b-full ${
                  item.id === 'ghost' ? 'bg-violet-600' : 'bg-blue-600'
                }`}
              />
            )}
            <div className="relative">
              {item.icon}
              {badge !== undefined && badge > 0 && (
                <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </div>
            <span className={`text-xs ${active ? 'font-semibold' : 'font-medium'}`}>
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
