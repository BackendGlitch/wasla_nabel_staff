import { useEffect } from 'react';
import type { UseStationData } from '@/kiosk/state/useStationData';
import type { UsePosWorkflow } from '@/kiosk/state/usePosWorkflow';

interface GhostScreenProps {
  station: UseStationData;
  workflow: UsePosWorkflow;
}

export function GhostScreen({ station, workflow }: GhostScreenProps) {
  useEffect(() => {
    if (!workflow.isGhostMode) {
      void workflow.handleEnterGhostMode();
    }
  }, [workflow]);

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"/>
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-bold text-violet-800 tracking-tight">Mode Fantôme</h2>
                <p className="text-xs text-violet-500">Réservation directe sans véhicule</p>
              </div>
            </div>
            <button
              onClick={workflow.handleExitGhostMode}
              className="h-9 px-4 rounded-xl bg-red-500 text-sm font-medium text-white hover:bg-red-600 transition-colors shadow-sm flex items-center gap-2"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12"/>
              </svg>
              Quitter
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-8">
            {station.allDestinations.map((dest) => {
              const isSelected = workflow.selectedGhostDestination?.destinationId === dest.id;
              return (
                <div
                  key={dest.id}
                  onClick={() => workflow.handleGhostDestinationSelect(dest)}
                  className={`relative p-5 rounded-2xl border-2 text-center cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-violet-50 border-violet-400 shadow-md shadow-violet-100'
                      : 'bg-white border-slate-200 hover:border-violet-300 hover:shadow-sm'
                  }`}
                >
                  <h3 className={`text-sm font-semibold mb-2 ${isSelected ? 'text-violet-700' : 'text-slate-700'}`}>{dest.name}</h3>
                  <p className={`text-2xl font-bold ${isSelected ? 'text-violet-600' : 'text-slate-800'}`}>{dest.basePrice.toFixed(2)}</p>
                  <span className="text-xs text-slate-400">TND</span>
                </div>
              );
            })}
          </div>

          {workflow.selectedGhostDestination && (
            <div className="bg-violet-50/40 border border-violet-200/60 rounded-2xl p-6">
              <div className="text-center mb-5">
                <h3 className="text-base font-bold text-violet-800">{workflow.selectedGhostDestination.destinationName}</h3>
                <p className="text-xs text-violet-500 mt-0.5">Sélectionnez le nombre de sièges</p>
              </div>
              <div className="grid grid-cols-8 gap-2 max-w-lg mx-auto mb-6">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((seatCount) => {
                  const isSelected = workflow.selectedSeats.length === seatCount;
                  return (
                    <button
                      key={seatCount}
                      onClick={() => workflow.handleSeatCountSelect(seatCount)}
                      className={`h-14 rounded-xl border-2 transition-all text-lg font-bold ${
                        isSelected
                          ? 'bg-violet-600 border-violet-600 text-white shadow-lg shadow-violet-600/30 scale-105'
                          : 'bg-white border-slate-200 text-violet-700 hover:border-violet-300 hover:bg-violet-50/50'
                      }`}
                    >
                      {seatCount}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-center gap-6">
                <div className="text-center">
                  <div className="text-2xl font-bold text-violet-800 tabular-nums">
                    {(workflow.selectedSeats.length * (workflow.selectedGhostDestination.basePrice || 0) + (workflow.selectedSeats.length * 0.2)).toFixed(2)}
                  </div>
                  <div className="text-xs text-violet-500 mt-0.5">TND total</div>
                </div>
                <button
                  onClick={workflow.handleGhostBooking}
                  disabled={workflow.bookingLoading || workflow.selectedSeats.length === 0}
                  className="h-12 px-8 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-all shadow-sm shadow-violet-600/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {workflow.bookingLoading ? (
                    <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>Création…</>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"/></svg>
                      Créer {workflow.selectedSeats.length} siège{workflow.selectedSeats.length === 1 ? '' : 's'}
                    </>
                  )}
                </button>
              </div>
              {workflow.lastGhostBookingForReprint && workflow.ghostPrintFailed && (
                <div className="mt-4 text-center">
                  <button
                    onClick={workflow.handleReprintLastGhostTicket}
                    disabled={workflow.bookingLoading}
                    className="h-9 px-5 rounded-lg border border-violet-200 text-xs font-medium text-violet-700 hover:bg-violet-50 transition-colors disabled:opacity-40"
                  >
                    Réimprimer #{workflow.lastGhostBookingForReprint.seatNumber}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
