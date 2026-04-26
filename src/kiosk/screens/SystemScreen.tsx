import UpdateStatus from '@/components/UpdateStatus';
import { Spacing, TouchSize } from '@/kiosk/tokens';

export interface SystemScreenProps {
  staffInfo: { firstName?: string; lastName?: string } | null;
  stationName?: string | null;
  isPosMode: boolean;
  machineId?: string | null;
  onOpenStation: () => void;
  onOpenAddVehicle: () => void;
  onLogout: () => void;
}

/**
 * System screen — settings, identity, and recovery actions (scaffold).
 *
 * Hosts the operator-facing maintenance affordances that used to live in the
 * legacy header: station picker, add-vehicle entry point, app version /
 * updates, and logout. Functions are wired to the existing handlers so this
 * screen is fully usable as soon as the kiosk preview opens — no behavioral
 * regression vs. legacy.
 *
 * Step 5 will add diagnostics (printer health snapshot, WS uptime, last sync,
 * pending offline actions). Today the goal is parity + a clean kiosk layout.
 */
export function SystemScreen({
  staffInfo,
  stationName,
  isPosMode,
  machineId,
  onOpenStation,
  onOpenAddVehicle,
  onLogout,
}: SystemScreenProps) {
  return (
    <div className="h-full w-full overflow-y-auto" style={{ padding: Spacing.lg }}>
      <div className="max-w-3xl mx-auto space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
            Identité
          </h2>
          <div className="mt-3 flex items-center gap-4">
            <div
              className="rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center text-xl font-bold"
              style={{ width: 56, height: 56 }}
            >
              {(staffInfo?.firstName?.[0] || '').toUpperCase()}
              {(staffInfo?.lastName?.[0] || '').toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-lg font-semibold text-slate-800">
                {staffInfo?.firstName || 'Agent'} {staffInfo?.lastName || ''}
              </div>
              <div className="text-sm text-slate-500">{stationName || 'Aucun poste'}</div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
            Machine
          </h2>
          <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-slate-500">Mode</dt>
              <dd className="font-semibold text-slate-800">
                {isPosMode ? 'POS (USB local)' : 'Normal (Ethernet)'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Identifiant machine</dt>
              <dd className="font-mono text-xs text-slate-700 break-all">
                {machineId || '—'}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
            Actions
          </h2>
          <div className="mt-4 space-y-3">
            <button
              type="button"
              onClick={onOpenStation}
              className="w-full rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 text-slate-800 font-semibold flex items-center justify-between transition-colors"
              style={{ minHeight: TouchSize.row, paddingInline: Spacing.md }}
            >
              <span className="flex items-center gap-3">
                <svg
                  className="w-5 h-5 text-slate-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                Changer de poste
              </span>
              <svg
                className="w-5 h-5 text-slate-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>

           
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
            Application
          </h2>
          <div className="mt-3">
            <UpdateStatus />
          </div>
        </section>

        <section className="rounded-2xl border border-red-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-red-500 uppercase tracking-wide">
            Session
          </h2>
          <button
            type="button"
            onClick={onLogout}
            className="mt-4 w-full rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold flex items-center justify-center gap-2 transition-colors"
            style={{ minHeight: TouchSize.primary }}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
            Se déconnecter
          </button>
        </section>
      </div>
    </div>
  );
}
