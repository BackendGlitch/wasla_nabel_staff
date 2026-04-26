import type { UseKioskNav } from '@/kiosk/state/useKioskNav';
import type { UsePosWorkflow } from '@/kiosk/state/usePosWorkflow';
import type { UseStationData } from '@/kiosk/state/useStationData';

interface HomeScreenProps {
  station: UseStationData;
  workflow: UsePosWorkflow;
  nav: UseKioskNav;
}

export function HomeScreen({ station, workflow, nav }: HomeScreenProps) {
  return (
    <div className="h-full w-full overflow-y-auto scrollbar-thin p-5">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold tracking-tight text-slate-800">Destinations</h2>
            <p className="text-xs mt-0.5 text-slate-400">Sélectionnez une destination</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5">
          {(station.summaries || []).map((s) => {
            const isSelected = station.selected?.destinationId === s.destinationId;
            const bookedCountForCard =
              station.todayTicketsByDestination[s.destinationId]?.regularCountToday ?? 0;
            return (
              <div
                key={s.destinationId}
                className={`relative p-3 rounded-xl border text-center cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-blue-50/60 border-blue-400 shadow-sm'
                    : 'bg-white border-slate-200 hover:border-blue-300 hover:bg-blue-50/30'
                }`}
                onClick={() => {
                  station.setSelected(s);
                  station.setQueue([]);
                  workflow.setSelectedVehicleForBooking(null);
                  workflow.setSelectedSeats([]);
                  workflow.saveSelectedVehicle(null);
                  station.setLoading(false);
                  nav.goBooking(s.destinationId);
                }}
              >
                {bookedCountForCard > 0 && (
                  <div className="absolute top-2 right-2 px-2 py-1 rounded-full bg-blue-600 text-white text-[10px] font-bold shadow-sm shadow-blue-600/25 tabular-nums">
                    {bookedCountForCard} sièges
                  </div>
                )}
                <h3 className="text-xs font-semibold text-slate-700 mb-1.5">{s.destinationName}</h3>
                {s.totalVehicles > 0 ? (
                  <>
                    <p className={`text-xl font-bold ${isSelected ? 'text-blue-600' : 'text-slate-800'}`}>
                      {s.availableSeats}
                    </p>
                    <span className="text-[10px] text-slate-400">places dispo</span>
                    <div className="text-[10px] text-slate-400 mt-0.5 font-medium">
                      {s.totalVehicles} véh.
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-bold text-slate-300 mt-1">0</p>
                    <span className="text-[10px] text-slate-400">Vide</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
