import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cancelOneBookingByQueueEntry, listQueue, listQueueSummaries } from '@/api/client';
import type { UseStationData } from '@/kiosk/state/useStationData';
import type { UsePosWorkflow } from '@/kiosk/state/usePosWorkflow';
import type { UseKioskNav } from '@/kiosk/state/useKioskNav';
import type { QueueEntry } from '@/kiosk/types';

interface BookingScreenProps {
  station: UseStationData;
  workflow: UsePosWorkflow;
  nav: UseKioskNav;
  showNotification: (message: string, type?: 'success' | 'error') => void;
}

function SortableRow({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.9 : 1,
    zIndex: isDragging ? 10 : 'auto',
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

export function BookingScreen({ station, workflow, nav, showNotification }: BookingScreenProps) {
  useEffect(() => {
    if (!nav.selectedDestinationId) return;
    if (station.selected?.destinationId === nav.selectedDestinationId) return;
    const target = station.summaries.find((s) => s.destinationId === nav.selectedDestinationId);
    if (target) station.setSelected(target);
  }, [nav.selectedDestinationId, station]);

  if (!station.selected) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center text-slate-400">
        <div className="text-lg font-medium">Sélectionnez une destination</div>
        <button
          type="button"
          onClick={nav.goHome}
          className="mt-4 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
        >
          Retour à l'accueil
        </button>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div className="border-b border-slate-100 bg-white px-5 py-2.5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">File des véhicules</h2>
            <div className="text-xs font-medium text-blue-600 mt-0.5">{station.selected.destinationName}</div>
          </div>
          <div className="flex items-center gap-2">
            {station.reordering && <div className="w-3 h-3 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />}
            {station.reorderSuccess && <span className="text-[11px] text-emerald-500 font-medium">Réorganisé</span>}
            <button
              type="button"
              onClick={nav.goHome}
              className="h-8 px-3.5 rounded-lg bg-slate-100 text-xs font-medium text-slate-700 hover:bg-slate-200 transition-colors"
            >
              Changer destination
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-1/2 border-r border-slate-200/80 overflow-y-auto scrollbar-thin bg-white">
          {station.loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-6 h-6 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin mx-auto mb-2"></div>
                <div className="text-xs text-slate-400">Chargement…</div>
              </div>
            </div>
          ) : station.queue.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center px-6">
                <svg className="w-10 h-10 text-slate-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" d="M5 17h2m10 0h2M5 11l1.5-4.5A2 2 0 018.4 5h7.2a2 2 0 011.9 1.5L19 11M3 17h18v-4a2 2 0 00-2-2H5a2 2 0 00-2 2z"/>
                </svg>
                <div className="text-sm font-medium text-slate-500 mb-1">File {station.selected.destinationName}</div>
                <div className="text-xs text-slate-400">Aucun véhicule dans la file</div>
              </div>
            </div>
          ) : (
            <DndContext
              sensors={workflow.sensors}
              collisionDetection={closestCenter}
              onDragEnd={workflow.handleDragEnd}
            >
              <SortableContext items={(station.queue || []).map((item) => item.id)} strategy={verticalListSortingStrategy}>
                <div className="divide-y divide-gray-100">
                  {(station.queue || []).map((entry, index) => (
                    <SortableRow key={entry.id} id={entry.id}>
                      <div
                        className={`p-3 transition-all ${workflow.selectedVehicleForBooking?.id === entry.id ? 'bg-blue-50/70' : 'bg-white hover:bg-blue-50/30'}`}
                      >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => {
                      if (workflow.selectedVehicleForBooking?.id === entry.id) {
                        workflow.setSelectedVehicleForBooking(null);
                        workflow.saveSelectedVehicle(null);
                        workflow.setSelectedSeats([]);
                      } else {
                        workflow.setSelectedVehicleForBooking(entry);
                        workflow.saveSelectedVehicle(entry);
                        workflow.setSelectedSeats([1]);
                      }
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-lg text-xs font-bold flex items-center justify-center ${
                          workflow.selectedVehicleForBooking?.id === entry.id
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {entry.queuePosition}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-700 truncate">{entry.licensePlate}</div>
                          <div className="text-xs text-slate-400">{entry.availableSeats} / {entry.totalSeats} places</div>
                        </div>
                      </div>
                    </div>
                  </button>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => workflow.handleMoveUp(index)}
                      disabled={index === 0 || station.reordering}
                      className="h-7 px-2 rounded border border-slate-200 text-[11px] text-slate-600 disabled:opacity-40"
                    >↑</button>
                    <button
                      type="button"
                      onClick={() => workflow.handleMoveDown(index)}
                      disabled={index === station.queue.length - 1 || station.reordering}
                      className="h-7 px-2 rounded border border-slate-200 text-[11px] text-slate-600 disabled:opacity-40"
                    >↓</button>
                    <button
                      type="button"
                      onClick={() => workflow.handleTransferSeats(entry.id)}
                      className="h-7 px-2.5 rounded border border-amber-200 bg-amber-50 text-[11px] text-amber-700"
                    >Transférer</button>
                    <button
                      type="button"
                      onClick={() => workflow.handleChangeDestination(entry.id)}
                      className="h-7 px-2.5 rounded border border-indigo-200 bg-indigo-50 text-[11px] text-indigo-700"
                    >Changer destination</button>
                    <button
                      type="button"
                      onClick={() => workflow.handleRemoveFromQueue(entry.id)}
                      className="h-7 px-2.5 rounded border border-red-200 bg-red-50 text-[11px] text-red-700"
                    >Retirer</button>
                  </div>
                      </div>
                    </SortableRow>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 bg-white">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-800">Réservation — {station.selected.destinationName}</h3>
            <div className="text-xs mt-0.5 text-slate-400">
              {workflow.selectedVehicleForBooking
                ? <><span className="font-mono font-medium text-blue-600">{workflow.selectedVehicleForBooking.licensePlate}</span></>
                : 'Attribution automatique'}
            </div>
          </div>

          <div className="flex gap-6 items-end">
            <div className="flex-1">
              <div className="text-center mb-3">
                <h4 className="text-[10px] font-semibold uppercase tracking-widest mb-2.5 text-slate-400">Nombre de sièges</h4>
                <div className="grid grid-cols-4 gap-1.5 max-w-sm mx-auto">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((seatCount) => {
                    const availableSeatsForBooking = workflow.selectedVehicleForBooking
                      ? workflow.selectedVehicleForBooking.availableSeats
                      : (station.selected?.availableSeats ?? 0);
                    const isDisabled = seatCount > availableSeatsForBooking;
                    const isSel = workflow.selectedSeats.length === seatCount;
                    return (
                      <button
                        key={seatCount}
                        onClick={() => workflow.handleSeatCountSelect(seatCount)}
                        disabled={isDisabled}
                        className={`h-11 rounded-xl border transition-all ${
                          isSel
                            ? 'bg-blue-600 border-blue-600 text-white shadow-sm shadow-blue-600/25'
                            : isDisabled
                              ? 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'
                              : 'bg-white border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-blue-50/50'
                        }`}
                      >
                        <div className="text-sm font-bold">{seatCount}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="text-[11px] mt-2 text-slate-400">
                  Dispo: {workflow.selectedVehicleForBooking
                    ? workflow.selectedVehicleForBooking.availableSeats
                    : (station.selected?.availableSeats ?? 0)}
                </div>
              </div>
            </div>

            <div className="w-72">
              <div className="space-y-2.5">
                {workflow.selectedVehicleForBooking && workflow.isSelectedVehicleStillInQueue && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!workflow.selectedVehicleForBooking || !workflow.isSelectedVehicleStillInQueue) return;
                      workflow.setBookingLoading(true);
                      try {
                        await cancelOneBookingByQueueEntry({ queueEntryId: workflow.selectedVehicleForBooking.id });
                        showNotification(`1 siège annulé pour le véhicule ${workflow.selectedVehicleForBooking.licensePlate}`, 'success');
                        station.setLoading(true);
                        try {
                          const response = await listQueue(station.selected!.destinationId);
                          const items = (response.data as unknown[]).map((e) => {
                            const x = e as Record<string, unknown>;
                            return {
                              ...x,
                              availableSeats: Number(x.availableSeats ?? 0),
                              totalSeats: Number(x.totalSeats ?? 0),
                              queuePosition: Number(x.queuePosition ?? 0),
                              bookedSeats: Number(x.bookedSeats ?? 0),
                            } as QueueEntry;
                          });
                          station.setQueue(items);
                          const summariesResponse = await listQueueSummaries();
                          station.setSummaries(summariesResponse.data || []);
                        } finally {
                          station.setLoading(false);
                        }
                      } catch {
                        showNotification("Échec de l'annulation.", 'error');
                      } finally {
                        workflow.setBookingLoading(false);
                      }
                    }}
                    disabled={workflow.bookingLoading || !workflow.isSelectedVehicleStillInQueue}
                    className="w-full h-9 text-xs bg-red-50 border border-red-300 text-red-700 hover:bg-red-100 rounded"
                  >
                    Annuler 1 siège
                  </button>
                )}
                <div className="text-center">
                  <div className="text-lg font-bold mb-2 tabular-nums text-slate-800">
                    {(workflow.selectedSeats.length * (station.selected?.basePrice || 0) + (workflow.selectedSeats.length * 0.2)).toFixed(2)}{' '}
                    <span className="text-xs font-semibold text-slate-400">TND</span>
                  </div>
                  <button
                    onClick={workflow.handleConfirmBooking}
                    disabled={workflow.bookingLoading || workflow.selectedSeats.length === 0}
                    className="w-full h-11 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/25"
                  >
                    {workflow.bookingLoading ? (
                      <span className="flex items-center justify-center">
                        <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin mr-2"></div>
                        Traitement…
                      </span>
                    ) : (
                      `Réserver ${workflow.selectedSeats.length} siège${workflow.selectedSeats.length === 1 ? '' : 's'}`
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-100 bg-white px-5 py-2.5">
        <div className="flex justify-end gap-1.5">
          <button
            onClick={() => nav.goGhost()}
            className="h-8 px-3.5 rounded-lg bg-violet-600 text-xs font-medium text-white hover:bg-violet-700 transition-colors shadow-sm shadow-violet-600/20"
          >
            Mode Fantôme
          </button>
        </div>
      </div>

      {workflow.transferModalOpen && workflow.transferFromEntry && (
        <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-xl p-4 shadow-xl">
            <h3 className="text-sm font-bold text-slate-800">Transférer des sièges</h3>
            <p className="text-xs text-slate-500 mt-1">Depuis {workflow.transferFromEntry.licensePlate}</p>
            <input
              value={workflow.transferSearchQuery}
              onChange={(e) => workflow.setTransferSearchQuery(e.target.value)}
              placeholder="Chercher un véhicule"
              className="mt-3 w-full h-10 rounded-lg border border-slate-200 px-3 text-sm"
            />
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              {[1,2,3,4,5].map((n) => (
                <button key={n} onClick={() => workflow.setTransferSeatsCount(n)} className={`h-8 rounded border text-xs ${workflow.transferSeatsCount===n?'bg-blue-600 text-white border-blue-600':'border-slate-200 text-slate-600'}`}>{n}</button>
              ))}
            </div>
            <div className="mt-3 max-h-40 overflow-y-auto space-y-1">
              {station.queue
                .filter((q) => q.id !== workflow.transferFromEntry?.id)
                .filter((q) => q.licensePlate.toLowerCase().includes(workflow.transferSearchQuery.toLowerCase()))
                .map((q) => (
                  <button
                    key={q.id}
                    onClick={() => workflow.handleConfirmTransfer(q)}
                    className="w-full text-left h-9 px-3 rounded border border-slate-200 hover:bg-slate-50 text-sm"
                  >
                    {q.licensePlate} ({q.availableSeats}/{q.totalSeats})
                  </button>
                ))}
            </div>
            <div className="mt-3 flex justify-end">
              <button onClick={() => workflow.setTransferModalOpen(false)} className="h-9 px-3 rounded bg-slate-100 text-sm">Fermer</button>
            </div>
          </div>
        </div>
      )}

      {workflow.changeDestModalOpen && workflow.changeDestFromEntry && (
        <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-xl p-4 shadow-xl">
            <h3 className="text-sm font-bold text-slate-800">Changer destination</h3>
            <p className="text-xs text-slate-500 mt-1">Véhicule {workflow.changeDestFromEntry.licensePlate}</p>
            <div className="mt-3 max-h-52 overflow-y-auto space-y-1">
              {workflow.loadingStations ? (
                <div className="text-xs text-slate-500">Chargement…</div>
              ) : (
                (workflow.authorizedStations as Array<Record<string, unknown>>).map((d, idx) => (
                  <button
                    key={String(d.stationId ?? d.id ?? idx)}
                    onClick={() =>
                      workflow.handleConfirmChangeDestination({
                        stationId: String(d.stationId ?? d.id ?? ''),
                        stationName: String(d.stationName ?? d.name ?? ''),
                      })
                    }
                    className="w-full text-left h-9 px-3 rounded border border-slate-200 hover:bg-slate-50 text-sm"
                  >
                    {String(d.stationName ?? d.name ?? '')}
                  </button>
                ))
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <button onClick={() => workflow.setChangeDestModalOpen(false)} className="h-9 px-3 rounded bg-slate-100 text-sm">Fermer</button>
            </div>
          </div>
        </div>
      )}

      {workflow.addVehicleModalOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded-xl p-4 shadow-xl">
            <h3 className="text-sm font-bold text-slate-800">Ajouter véhicule</h3>
            <input
              value={workflow.vehicleSearchQuery}
              onChange={(e) => workflow.handleSearchInputChange(e.target.value)}
              placeholder="Chercher par matricule"
              className="mt-3 w-full h-10 rounded-lg border border-slate-200 px-3 text-sm"
            />
            <div className="mt-3 max-h-56 overflow-y-auto space-y-1">
              {workflow.loadingSearch ? (
                <div className="text-xs text-slate-500">Recherche…</div>
              ) : (
                (workflow.searchResults as Array<{id:string;licensePlate:string;seatCount:number}>).map((v) => (
                  <button
                    key={v.id}
                    onClick={() => workflow.handleSelectVehicle(v)}
                    className={`w-full text-left h-10 px-3 rounded border text-sm ${workflow.selectedVehicle && (workflow.selectedVehicle as {id:string}).id === v.id ? 'border-blue-500 bg-blue-50':'border-slate-200 hover:bg-slate-50'}`}
                  >
                    {v.licensePlate} ({v.seatCount} places)
                  </button>
                ))
              )}
            </div>

            {!!workflow.selectedVehicle && (
              <div className="mt-3 border-t pt-3">
                <div className="text-xs text-slate-500 mb-2">Destinations autorisées</div>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {(workflow.vehicleAuthorizedStations as Array<Record<string, unknown>>).map((d, idx) => (
                    <button
                      key={String(d.stationId ?? d.id ?? idx)}
                      onClick={() =>
                        workflow.handleConfirmAddVehicle({
                          stationId: String(d.stationId ?? d.id ?? ''),
                          stationName: String(d.stationName ?? d.name ?? ''),
                        })
                      }
                      className="w-full text-left h-9 px-3 rounded border border-slate-200 hover:bg-slate-50 text-sm"
                    >
                      {String(d.stationName ?? d.name ?? '')}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => {
                  workflow.setAddVehicleModalOpen(false);
                  workflow.setVehicleSearchQuery('');
                  workflow.setSearchResults([]);
                  workflow.setSelectedVehicle(null);
                  workflow.setSearchError(null);
                  workflow.setLoadingSearch(false);
                }}
                className="h-9 px-3 rounded bg-slate-100 text-sm"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
