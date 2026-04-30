import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteQueueEntry,
  getAllDestinations,
  getTodayBookedTicketsByDestination,
  listQueue,
  listQueueSummaries,
} from '@/api/client';
import { connectQueue } from '@/ws/client';
import type { StationConfig } from '@/components/StationSetupScreen';
import type {
  Destination,
  QueueEntry,
  Summary,
  TodayTicketsByDestination,
} from '@/kiosk/types';

export interface UseStationDataOptions {
  selectedStation: StationConfig | null;
  servedDestinationIds: string[];
  showNotification: (message: string, type?: 'success' | 'error') => void;
}

/**
 * Station data layer.
 *
 * Owns every piece of state the kiosk reads about destinations and queues:
 *   - `summaries` : per-destination availability / vehicle counts.
 *   - `selected`  : the currently focused destination (drives WS subscription).
 *   - `queue`     : the live queue for the selected destination.
 *   - `loading` / `reordering` / `reorderSuccess` : UI flags.
 *   - `todayTicketsByDestination` : counters used for the badge on tiles.
 *   - `wsConnected` / `wsLatency` : status pill metadata.
 *
 * It also handles the side-effects that keep these values fresh:
 *   - Background WS watchers for non-selected destinations to keep cards live.
 *   - Foreground WS subscription for the selected destination.
 *   - Initial load when the user picks (or switches) a `selectedStation`.
 *   - Auto-removal of fully booked vehicles inside `refreshQueueAndSummaries`.
 *
 * The public surface is intentionally a flat record of `state + setters +
 * actions`. This lets `MainPage.tsx` keep its existing JSX unchanged in Step 1
 * (it just destructures everything to local names) while later steps can
 * consume only the fields they need.
 */
export function useStationData({
  selectedStation,
  servedDestinationIds,
  showNotification,
}: UseStationDataOptions) {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [allDestinations, setAllDestinations] = useState<Destination[]>([]);
  const allDestinationsRef = useRef<Destination[]>([]);
  const summariesRefreshTimerRef = useRef<number | null>(null);
  const [selected, setSelected] = useState<Summary | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [reorderSuccess, setReorderSuccess] = useState(false);
  const [todayTicketsByDestination, setTodayTicketsByDestination] =
    useState<TodayTicketsByDestination>({});

  const [wsConnected, setWsConnected] = useState(false);
  const [wsLatency, setWsLatency] = useState<number | undefined>(undefined);
  const wsClientRef = useRef<ReturnType<typeof connectQueue> | null>(null);
  const wsSummaryWatchersRef = useRef<Record<string, ReturnType<typeof connectQueue>>>({});

  // Always keep the ref in sync for handlers that fire from WS callbacks
  // outside of React's render lifecycle.
  useEffect(() => {
    allDestinationsRef.current = allDestinations;
  }, [allDestinations]);

  // Stable references to the latest values for use inside imperative effects
  // that should not retrigger on every change.
  const selectedRef = useRef<Summary | null>(null);
  selectedRef.current = selected;
  const reorderingRef = useRef(false);
  reorderingRef.current = reordering;

  /**
   * Throttled merge-summaries refresh, fired from WS message callbacks.
   *
   * WS messages arrive in bursts when the queue mutates; coalescing into a
   * single `listQueueSummaries + getTodayBookedTicketsByDestination` call
   * after a short debounce avoids hammering the backend.
   */
  const scheduleSummariesRefresh = useCallback(() => {
    if (summariesRefreshTimerRef.current !== null) {
      window.clearTimeout(summariesRefreshTimerRef.current);
    }
    summariesRefreshTimerRef.current = window.setTimeout(async () => {
      try {
        const [summariesResponse, ticketsResponse] = await Promise.all([
          listQueueSummaries('all'),
          getTodayBookedTicketsByDestination(),
        ]);
        const queueSummaries = summariesResponse.data || [];
        const dests = allDestinationsRef.current || [];
        const todayTicketItems = ticketsResponse.data || [];
        const merged = dests.map((dest) => {
          const q = queueSummaries.find((x) => x.destinationId === dest.id);
          return {
            destinationId: dest.id,
            destinationName: dest.name,
            totalVehicles: q?.totalVehicles || 0,
            totalSeats: q?.totalSeats || 0,
            availableSeats: q?.availableSeats || 0,
            basePrice: dest.basePrice,
            serviceFee: dest.serviceFee ?? 0.2,
          } as Summary;
        });
        setSummaries(merged);

        const map: TodayTicketsByDestination = {};
        for (const item of todayTicketItems) {
          map[item.destinationId] = {
            regularCountToday: item.regularCountToday ?? 0,
            ghostCountToday: item.ghostCountToday ?? 0,
            totalToday: item.totalToday ?? 0,
          };
        }
        setTodayTicketsByDestination(map);
      } catch (err) {
        console.error('Failed to refresh summaries:', err);
      }
    }, 300);
  }, []);

  /**
   * Centralised refresh used after every mutating user action.
   *
   * `destinationId` lets the caller refresh a non-selected destination (e.g.
   * after adding a vehicle to a different queue); when omitted it refreshes
   * the currently selected destination's queue. Fully booked vehicles are
   * proactively removed here to keep the operator from booking phantom seats.
   */
  const refreshQueueAndSummaries = useCallback(
    async (destinationId?: string) => {
      setLoading(true);
      try {
        const targetDestinationId = destinationId || selectedRef.current?.destinationId;
        if (targetDestinationId) {
          const response = await listQueue(targetDestinationId);
          const items = ((response.data as unknown[]) || []).map((raw) => {
            const e = raw as Partial<QueueEntry> & Record<string, unknown>;
            return {
              ...e,
              availableSeats: Number(e.availableSeats ?? 0),
              totalSeats: Number(e.totalSeats ?? 0),
              queuePosition: Number(e.queuePosition ?? 0),
              bookedSeats: Number(e.bookedSeats ?? 0),
              hasTripsToday: e.hasTripsToday ?? false,
              status: e.status,
            } as QueueEntry;
          });

          const fullyBookedVehicles = items.filter((item) => item.availableSeats === 0);

          if (fullyBookedVehicles.length > 0) {
            console.log(
              'Found fully booked vehicles to remove:',
              fullyBookedVehicles.map((v) => v.licensePlate),
            );
            for (const vehicle of fullyBookedVehicles) {
              try {
                await deleteQueueEntry(targetDestinationId, vehicle.id);
                console.log(
                  'Fully booked vehicle removed from queue successfully:',
                  vehicle.licensePlate,
                );
                showNotification(
                  `Le Vehicule ${vehicle.licensePlate} a été retiré de la file car il est maintenant complet.`,
                  'success',
                );
              } catch (removeError) {
                console.error('Failed to remove fully booked vehicle from queue:', removeError);
              }
            }

            const filteredItems = items.filter((item) => item.availableSeats > 0);
            if (
              !destinationId ||
              (selectedRef.current && selectedRef.current.destinationId === targetDestinationId)
            ) {
              setQueue(filteredItems);
            }
          } else if (
            !destinationId ||
            (selectedRef.current && selectedRef.current.destinationId === targetDestinationId)
          ) {
            setQueue(items);
          }
        }

        const [destinationsResponse, summariesResponse, ticketsResponse] = await Promise.all([
          getAllDestinations(),
          listQueueSummaries('all'),
          getTodayBookedTicketsByDestination(),
        ]);

        const allDests = destinationsResponse.data || [];
        const queueSummaries = summariesResponse.data || [];
        const todayTicketItems = ticketsResponse.data || [];

        const allowed = selectedStation ? servedDestinationIds : allDests.map((d) => d.id);
        setAllDestinations(allDests.filter((d) => allowed.includes(d.id)));

        const mergedSummaries = allDests.map((dest) => {
          const queueData = queueSummaries.find((q) => q.destinationId === dest.id);
          return {
            destinationId: dest.id,
            destinationName: dest.name,
            totalVehicles: queueData?.totalVehicles || 0,
            totalSeats: queueData?.totalSeats || 0,
            availableSeats: queueData?.availableSeats || 0,
            basePrice: dest.basePrice,
            serviceFee: dest.serviceFee ?? 0.2,
          };
        });

        setSummaries(mergedSummaries.filter((s) => allowed.includes(s.destinationId)));

        const map: TodayTicketsByDestination = {};
        for (const item of todayTicketItems) {
          map[item.destinationId] = {
            regularCountToday: item.regularCountToday ?? 0,
            ghostCountToday: item.ghostCountToday ?? 0,
            totalToday: item.totalToday ?? 0,
          };
        }
        setTodayTicketsByDestination(map);

        console.log('Queue and summaries refreshed successfully');
      } catch (refreshError) {
        console.error('Failed to refresh queue and summaries:', refreshError);
      } finally {
        setLoading(false);
      }
    },
    [selectedStation, servedDestinationIds, showNotification],
  );

  /**
   * Light fetch used when entering ghost mode — pulls all destinations the
   * workstation is allowed to serve, without touching the queue caches.
   */
  const loadAllDestinations = useCallback(async () => {
    try {
      const response = await getAllDestinations();
      const allDests = response.data || [];
      const allowed = selectedStation ? servedDestinationIds : allDests.map((d) => d.id);
      setAllDestinations(allDests.filter((d) => allowed.includes(d.id)));
    } catch (error) {
      console.error('Failed to load destinations:', error);
    }
  }, [selectedStation, servedDestinationIds]);

  // Initial load when the workstation's served destinations change.
  useEffect(() => {
    const loadData = async () => {
      if (!selectedStation) return;
      try {
        const [destinationsResponse, summariesResponse] = await Promise.all([
          getAllDestinations(),
          listQueueSummaries('all'),
        ]);

        const allDests = destinationsResponse.data || [];
        const queueSummaries = summariesResponse.data || [];

        const allowed = servedDestinationIds;
        const filteredDests = allDests.filter((dest) => allowed.includes(dest.id));

        setAllDestinations(filteredDests);

        const mergedSummaries = filteredDests.map((dest) => {
          const queueData = queueSummaries.find((q) => q.destinationId === dest.id);
          return {
            destinationId: dest.id,
            destinationName: dest.name,
            totalVehicles: queueData?.totalVehicles || 0,
            totalSeats: queueData?.totalSeats || 0,
            availableSeats: queueData?.availableSeats || 0,
            basePrice: dest.basePrice,
            serviceFee: dest.serviceFee ?? 0.2,
          };
        });

        setSummaries(mergedSummaries);

        // Auto-select the first destination so the operator lands on a live
        // queue without an extra tap.
        if (!selectedRef.current && mergedSummaries.length > 0) {
          setSelected(mergedSummaries[0]);
        }
      } catch (err) {
        console.error('Failed to load destinations and summaries:', err);
      }
    };

    loadData();
  }, [selectedStation, servedDestinationIds]);

  // Background WS watchers for every non-selected destination. These keep the
  // tile counters live without forcing the operator to switch destinations.
  useEffect(() => {
    if (!allDestinations || allDestinations.length === 0) return;

    const destIds = allDestinations.map((d) => d.id);
    const wanted = new Set(destIds);
    const selectedId = selected?.destinationId;

    for (const [destId, ctrl] of Object.entries(wsSummaryWatchersRef.current)) {
      if (!wanted.has(destId) || destId === selectedId) {
        try {
          ctrl?.close?.();
        } catch {
          // ignore cleanup errors; watcher is being discarded
        }
        delete wsSummaryWatchersRef.current[destId];
      }
    }

    for (const destId of destIds) {
      if (destId === selectedId) continue;
      if (wsSummaryWatchersRef.current[destId]) continue;

      wsSummaryWatchersRef.current[destId] = connectQueue(destId, {
        onOpen: () => {},
        onClose: () => {},
        onError: () => {},
        onLatencyUpdate: () => {},
        onConnectionStatus: () => {},
        onMessage: () => {
          scheduleSummariesRefresh();
        },
      });
    }

    return () => {
      for (const ctrl of Object.values(wsSummaryWatchersRef.current)) {
        try {
          ctrl?.close?.();
        } catch {
          // ignore cleanup errors; watcher is being discarded
        }
      }
      wsSummaryWatchersRef.current = {};
    };
  }, [allDestinations, selected?.destinationId, scheduleSummariesRefresh]);

  // Foreground WS subscription for the selected destination — drives the
  // per-row queue list and latency pill.
  useEffect(() => {
    if (!selected) {
      if (wsClientRef.current) {
        wsClientRef.current.close();
        wsClientRef.current = null;
        setWsConnected(false);
        setWsLatency(undefined);
      }
      return;
    }

    if (wsClientRef.current) {
      wsClientRef.current.close();
      wsClientRef.current = null;
    }

    const loadInitialData = async () => {
      setLoading(true);
      try {
        const r = await listQueue(selected.destinationId);
        const items = ((r.data as unknown[]) || []).map((raw) => {
          const e = raw as Partial<QueueEntry> & Record<string, unknown>;
          return {
            ...e,
            availableSeats: Number(e.availableSeats ?? 0),
            totalSeats: Number(e.totalSeats ?? 0),
            queuePosition: Number(e.queuePosition ?? 0),
            status: e.status,
            hasTripsToday: e.hasTripsToday ?? false,
          } as QueueEntry;
        });
        setQueue(items);
      } finally {
        setLoading(false);
      }
    };

    const wsCtrl = connectQueue(selected.destinationId, {
      onOpen: () => {
        console.log('WebSocket connected to', selected.destinationId);
        setWsConnected(true);
        loadInitialData().catch(console.error);
      },
      onClose: () => {
        console.log('WebSocket disconnected from', selected.destinationId);
        setWsConnected(false);
        setWsLatency(undefined);
      },
      onError: (error) => {
        console.error('WebSocket error:', error);
        setWsConnected(false);
        setWsLatency(undefined);
      },
      onLatencyUpdate: (latency) => {
        setWsLatency(latency);
      },
      onConnectionStatus: (connected, latency) => {
        setWsConnected(connected);
        if (latency !== undefined) setWsLatency(latency);
      },
      onMessage: (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          console.log('WebSocket message received:', msg.type);

          if (msg.type && (msg.type.includes('queue_') || msg.type.includes('queue_entry'))) {
            if (msg.data?.queue) {
              const items = (msg.data.queue as unknown[]).map((raw) => {
                const e = raw as Partial<QueueEntry> & Record<string, unknown>;
                return {
                  ...e,
                  availableSeats: Number(e.availableSeats ?? 0),
                  totalSeats: Number(e.totalSeats ?? 0),
                  queuePosition: Number(e.queuePosition ?? 0),
                  status: e.status,
                  hasTripsToday: e.hasTripsToday ?? false,
                } as QueueEntry;
              });
              if (!reorderingRef.current) {
                setQueue(items);
                scheduleSummariesRefresh();
              }
            } else if (msg.type === 'queue_reordered' && !reorderingRef.current) {
              listQueue(selected.destinationId)
                .then((r) => {
                  const items = ((r.data as unknown[]) || []).map((raw) => {
                    const e = raw as Partial<QueueEntry> & Record<string, unknown>;
                    return {
                      ...e,
                      availableSeats: Number(e.availableSeats ?? 0),
                      totalSeats: Number(e.totalSeats ?? 0),
                      queuePosition: Number(e.queuePosition ?? 0),
                      status: e.status,
                      hasTripsToday: e.hasTripsToday ?? false,
                    } as QueueEntry;
                  });
                  setQueue(items);
                  scheduleSummariesRefresh();
                })
                .catch(console.error);
            } else if (msg.type === 'queue_entry_removed' && !reorderingRef.current) {
              if (msg.data?.queueEmpty === true) {
                console.log('Queue is now empty for destination:', msg.data.destinationId);
                Promise.all([getAllDestinations(), listQueueSummaries('all')])
                  .then(([destinationsResponse, summariesResponse]) => {
                    const allDests = destinationsResponse.data || [];
                    const queueSummaries = summariesResponse.data || [];

                    const allowed = selectedStation
                      ? servedDestinationIds
                      : allDests.map((d) => d.id);
                    const filteredDests = allDests.filter((dest) => allowed.includes(dest.id));

                    setAllDestinations(filteredDests);

                    const mergedSummaries = filteredDests.map((dest) => {
                      const queueData = queueSummaries.find(
                        (q) => q.destinationId === dest.id,
                      );
                      return {
                        destinationId: dest.id,
                        destinationName: dest.name,
                        totalVehicles: queueData?.totalVehicles || 0,
                        totalSeats: queueData?.totalSeats || 0,
                        availableSeats: queueData?.availableSeats || 0,
                        basePrice: dest.basePrice,
                        serviceFee: dest.serviceFee ?? 0.2,
                      };
                    });

                    setSummaries(mergedSummaries);

                    if (
                      selectedRef.current &&
                      selectedRef.current.destinationId === msg.data.destinationId
                    ) {
                      setQueue([]);
                    }
                  })
                  .catch(console.error);
              } else {
                listQueue(selected.destinationId)
                  .then((r) => {
                    const items = ((r.data as unknown[]) || []).map((raw) => {
                      const e = raw as Partial<QueueEntry> & Record<string, unknown>;
                      return {
                        ...e,
                        availableSeats: Number(e.availableSeats ?? 0),
                        totalSeats: Number(e.totalSeats ?? 0),
                        queuePosition: Number(e.queuePosition ?? 0),
                        status: e.status,
                        hasTripsToday: e.hasTripsToday ?? false,
                      } as QueueEntry;
                    });
                    setQueue(items);
                    scheduleSummariesRefresh();
                  })
                  .catch(console.error);
              }
            } else if (!reorderingRef.current) {
              listQueue(selected.destinationId)
                .then((r) => {
                  const items = ((r.data as unknown[]) || []).map((raw) => {
                    const e = raw as Partial<QueueEntry> & Record<string, unknown>;
                    return {
                      ...e,
                      availableSeats: Number(e.availableSeats ?? 0),
                      totalSeats: Number(e.totalSeats ?? 0),
                      queuePosition: Number(e.queuePosition ?? 0),
                      status: e.status,
                      hasTripsToday: e.hasTripsToday ?? false,
                    } as QueueEntry;
                  });
                  setQueue(items);
                  scheduleSummariesRefresh();
                })
                .catch(console.error);
            }
          } else if (!reorderingRef.current) {
            scheduleSummariesRefresh();
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      },
    });

    wsClientRef.current = wsCtrl;
    loadInitialData();

    return () => {
      if (wsClientRef.current) {
        wsClientRef.current.close();
        wsClientRef.current = null;
      }
      setWsConnected(false);
      setWsLatency(undefined);
    };
    // The original component intentionally only re-subscribes when the
    // destinationId changes. We replicate that exactly to avoid burst
    // reconnects when other props change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.destinationId]);

  return {
    summaries,
    setSummaries,
    allDestinations,
    setAllDestinations,
    selected,
    setSelected,
    queue,
    setQueue,
    loading,
    setLoading,
    reordering,
    setReordering,
    reorderSuccess,
    setReorderSuccess,
    todayTicketsByDestination,
    setTodayTicketsByDestination,
    wsConnected,
    wsLatency,
    refreshQueueAndSummaries,
    loadAllDestinations,
    scheduleSummariesRefresh,
  };
}

export type UseStationData = ReturnType<typeof useStationData>;
