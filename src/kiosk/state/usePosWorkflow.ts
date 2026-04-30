import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  addVehicleToQueue,
  createBookingByDestination,
  createBookingByQueueEntry,
  createGhostBooking,
  getStaffInfo,
  getVehicleAuthorizedRoutes,
  reorderQueue,
  searchVehicles,
} from "@/api/client";
import { printerService, type TicketData } from "@/services/printerService";
import {
  enqueueOfflineAction,
  isOnline,
  newActionId,
  processOfflineQueue,
} from "@/services/offlineQueue";
import type {
  GhostBookingForReprint,
  QueueEntry,
  Summary,
} from "@/kiosk/types";
import type { UseStationData } from "./useStationData";

export interface UsePosWorkflowOptions {
  station: UseStationData;
  showNotification: (message: string, type?: "success" | "error") => void;
}

/**
 * Read staff identity from the JWT, falling back to the cached blob in
 * localStorage (some legacy logins set this synchronously before the JWT
 * decoder is available).
 */
function getStaffInfoLocal() {
  const jwtInfo = getStaffInfo();
  if (jwtInfo?.firstName && jwtInfo?.lastName) {
    return jwtInfo;
  }
  try {
    const stored = localStorage.getItem("staffInfo");
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // localStorage may be unavailable in private browsing — fall through.
  }
  return null;
}

/** Prefer JWT first+last; never show API login usernames like staff_supervisor_001 on tickets. */
function bookingPrintStaffFields(
  booking: { createdByName?: string; createdBy?: string },
  staff:
    | ReturnType<typeof getStaffInfoLocal>
    | { firstName?: string; lastName?: string }
    | null,
): Pick<
  TicketData,
  "staffFirstName" | "staffLastName" | "createdByName" | "createdBy"
> {
  const fn = ((staff?.firstName ?? "") as string).trim();
  const ln = ((staff?.lastName ?? "") as string).trim();
  const jwtName = `${fn} ${ln}`.trim();
  const apiName = (booking?.createdByName ?? "").trim();

  const technical = (s: string) => {
    const low = s.toLowerCase();
    return low.includes("staff_supervisor") || (!s.includes(" ") && low.startsWith("staff_"));
  };

  const display =
    jwtName || (apiName && !technical(apiName) ? apiName : "");

  return {
    staffFirstName: fn,
    staffLastName: ln,
    ...(display ? { createdByName: display } : {}),
    createdBy: display || "Staff",
  };
}

/**
 * Operator workflow.
 *
 * Concentrates every piece of state and every side-effect that mutate the
 * queue or trigger printing:
 *   - booking flow (seat picker, vehicle selection, talon printing).
 *   - ghost mode (direct destination booking with reprint memory).
 *   - queue management modal (add vehicle).
 *   - vehicle search with debounced + race-controlled requests.
 *   - drag-and-drop / arrow-button reorder.
 *   - the durable, idempotent talon-print retry loop.
 *   - the background offline-queue drain.
 *
 * The hook accepts the station data layer (for queue/selected/refresh) and a
 * showNotification callback. Nothing visual lives here — UI is left to
 * `MainPage.tsx` (Step 1) and the future kiosk screens (Step 2+).
 */
export function usePosWorkflow({
  station,
  showNotification,
}: UsePosWorkflowOptions) {
  const staffInfo = getStaffInfoLocal();

  // ── Booking ──────────────────────────────────────────────────────────────
  const [selectedSeats, setSelectedSeats] = useState<number[]>([1]);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [selectedVehicleForBooking, setSelectedVehicleForBooking] =
    useState<QueueEntry | null>(null);

  // ── Modal: add vehicle ───────────────────────────────────────────────────
  const [addVehicleModalOpen, setAddVehicleModalOpen] = useState(false);
  const [vehicleSearchQuery, setVehicleSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<unknown[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<unknown>(null);
  const [vehicleAuthorizedStations, setVehicleAuthorizedStations] = useState<
    unknown[]
  >([]);
  const [loadingVehicleStations, setLoadingVehicleStations] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const vehicleSearchDebounceRef = useRef<number | null>(null);
  const latestSearchSeqRef = useRef(0);

  // ── Ghost mode ───────────────────────────────────────────────────────────
  const [isGhostMode, setIsGhostMode] = useState(false);
  const [selectedGhostDestination, setSelectedGhostDestination] =
    useState<Summary | null>(null);
  const ghostDebounceRef = useRef<number | null>(null);
  const ghostLastActionRef = useRef<{
    idempotencyKey: string;
    destinationId: string;
    seats: number;
  } | null>(null);
  const [lastGhostBookingForReprint, setLastGhostBookingForReprint] =
    useState<GhostBookingForReprint | null>(null);
  const [ghostPrintFailed, setGhostPrintFailed] = useState(false);

  // ── DnD sensors ──────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // ── Persistence helpers ──────────────────────────────────────────────────
  const saveSelectedVehicle = useCallback((vehicle: QueueEntry | null) => {
    if (vehicle) {
      localStorage.setItem(
        "selectedVehicleForBooking",
        JSON.stringify({
          id: vehicle.id,
          vehicleId: vehicle.vehicleId,
          licensePlate: vehicle.licensePlate,
          queuePosition: vehicle.queuePosition,
        }),
      );
    } else {
      localStorage.removeItem("selectedVehicleForBooking");
    }
  }, []);

  // ── DnD / reorder handlers ───────────────────────────────────────────────
  const reorderQueueItems = useCallback(
    async (oldIndex: number, newIndex: number) => {
      const previousQueue = station.queue;
      const newQueue = arrayMove(previousQueue, oldIndex, newIndex);
      const updatedQueue = newQueue.map((item, index) => ({
        ...item,
        queuePosition: index + 1,
      }));
      station.setQueue(updatedQueue);
      station.setReordering(true);

      try {
        const entryIds = updatedQueue.map((item) => item.id);
        await reorderQueue(station.selected!.destinationId, entryIds);
        station.setReorderSuccess(true);
        setTimeout(() => station.setReorderSuccess(false), 2000);

        await station.refreshQueueAndSummaries();
      } catch (error) {
        console.error("Failed to reorder queue:", error);
        station.setQueue(previousQueue);
      } finally {
        station.setReordering(false);
      }
    },
    [station],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (active.id !== over?.id && station.selected) {
        const oldIndex = station.queue.findIndex(
          (item) => item.id === active.id,
        );
        const newIndex = station.queue.findIndex(
          (item) => item.id === over?.id,
        );
        if (oldIndex !== -1 && newIndex !== -1) {
          await reorderQueueItems(oldIndex, newIndex);
        }
      }
    },
    [station.selected, station.queue, reorderQueueItems],
  );

  const handleMoveUp = useCallback(
    async (index: number) => {
      if (index > 0 && station.selected) {
        await reorderQueueItems(index, index - 1);
      }
    },
    [station.selected, reorderQueueItems],
  );

  const handleMoveDown = useCallback(
    async (index: number) => {
      if (index < station.queue.length - 1 && station.selected) {
        await reorderQueueItems(index, index + 1);
      }
    },
    [station.selected, station.queue.length, reorderQueueItems],
  );

  // ── Add vehicle: search + select + confirm ───────────────────────────────
  const handleVehicleSearch = useCallback(async (query: string) => {
    if (query.length === 0) {
      setSearchResults([]);
      setSearchError(null);
      setLoadingSearch(false);
      return;
    }

    const seq = ++latestSearchSeqRef.current;
    setLoadingSearch(true);
    setSearchError(null);
    try {
      const response = await searchVehicles(query);
      if (seq !== latestSearchSeqRef.current) {
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (response as any)?.data;
      if (data && Array.isArray(data)) {
        setSearchResults(data);
        if (data.length === 0) {
          setSearchError(null);
        }
      } else {
        setSearchResults([]);
        setSearchError(
          "Aucun Vehicule trouvé correspondant à votre recherche.",
        );
      }
    } catch (error) {
      console.error("Échec de la recherche de Vehicules :", error);
      if (seq === latestSearchSeqRef.current) {
        setSearchResults([]);
        setSearchError(
          "Échec de la recherche de Vehicules. Veuillez réessayer.",
        );
      }
    } finally {
      if (seq === latestSearchSeqRef.current) {
        setLoadingSearch(false);
      }
    }
  }, []);

  const handleSearchInputChange = useCallback(
    (query: string) => {
      setVehicleSearchQuery(query);
      if (vehicleSearchDebounceRef.current) {
        window.clearTimeout(vehicleSearchDebounceRef.current);
      }
      vehicleSearchDebounceRef.current = window.setTimeout(() => {
        handleVehicleSearch(query);
      }, 300);
    },
    [handleVehicleSearch],
  );

  const handleSelectVehicle = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (vehicle: any) => {
      if (!vehicle || !vehicle.id) {
        console.error("Vehicule sélectionné non valide");
        return;
      }

      setSelectedVehicle(vehicle);
      setVehicleAuthorizedStations([]);
      setLoadingVehicleStations(true);

      try {
        const response = await getVehicleAuthorizedRoutes(vehicle.id);
        if (response && response.data && Array.isArray(response.data)) {
          setVehicleAuthorizedStations(response.data);
        } else {
          setVehicleAuthorizedStations([]);
          console.warn(
            "Aucune station autorisée trouvée pour le Vehicule :",
            vehicle.licensePlate,
          );
        }
      } catch (error) {
        console.error("Échec du chargement des stations autorisées :", error);
        setVehicleAuthorizedStations([]);
      } finally {
        setLoadingVehicleStations(false);
      }
    },
    [],
  );

  const handleConfirmAddVehicle = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (stationArg: any) => {
      if (!selectedVehicle) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const veh = selectedVehicle as any;

      try {
        setLoadingVehicleStations(true);
        await addVehicleToQueue(
          stationArg.stationId,
          veh.id,
          stationArg.stationName,
        );

        showNotification(
          `${veh.licensePlate} ajouté à la file de ${stationArg.stationName}`,
          "success",
        );

        await station.refreshQueueAndSummaries(stationArg.stationId);

        setAddVehicleModalOpen(false);
        setVehicleSearchQuery("");
        setSearchResults([]);
        setSelectedVehicle(null);
        setVehicleAuthorizedStations([]);

        console.log(
          `Successfully added ${veh.licensePlate} to ${stationArg.stationName} queue`,
        );
      } catch (error) {
        console.error("Échec de l'ajout du Vehicule à la file :", error);
        showNotification(
          "Échec de l'ajout du Vehicule à la file. Veuillez réessayer.",
          "error",
        );
      } finally {
        setLoadingVehicleStations(false);
      }
    },
    [selectedVehicle, station, showNotification],
  );

  // ── Booking ──────────────────────────────────────────────────────────────
  const handleSeatCountSelect = useCallback((seatCount: number) => {
    setSelectedSeats(Array.from({ length: seatCount }, (_, i) => i + 1));
  }, []);

  /**
   * Money-critical: enqueue a booking ticket and wait until the durable job
   * reaches `printed`. Each retry uses a unique idempotency key suffix so the
   * backend does not collapse the retries to the first failed job.
   */
  const printBookingGuaranteed = useCallback(
    async (
      ticketData: TicketData,
      audit: {
        bookingId?: string;
        printerId?: string;
        idempotencyKeyBase: string;
      },
      label: string,
      maxRetries = 6,
    ): Promise<void> => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const idempotencyKey = `${audit.idempotencyKeyBase}-try${attempt}`;
        try {
          const jobId = await printerService.enqueueBookingTicket(ticketData, {
            bookingId: audit.bookingId,
            printerId: audit.printerId,
            idempotencyKey,
          });
          const job = await printerService.waitForPrintJob(jobId, {
            timeoutMs: 25000,
            pollMs: 600,
          });
          if (job.status === "printed") return;
          throw new Error(job.lastError || `print failed (jobId=${jobId})`);
        } catch (err) {
          console.warn(
            `[PrintGuaranteed] ${label} attempt ${attempt}/${maxRetries} failed:`,
            err,
          );
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 1200));
          } else {
            throw err;
          }
        }
      }
    },
    [],
  );

  const handleConfirmBooking = useCallback(async () => {
    if (!station.selected || selectedSeats.length === 0) return;
    if (bookingLoading) return;

    setBookingLoading(true);

    try {
      const bookingIdempotencyKey =
        crypto?.randomUUID?.() ??
        `book-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      if (selectedVehicleForBooking) {
        const doRequest = async () =>
          createBookingByQueueEntry({
            queueEntryId: selectedVehicleForBooking.id,
            seats: selectedSeats.length,
            idempotencyKey: bookingIdempotencyKey,
          });
        const response = isOnline()
          ? await doRequest()
          : await (async () => {
              const id = newActionId("offline");
              await enqueueOfflineAction({
                id,
                type: "createBookingByQueueEntry",
                payload: {
                  queueEntryId: selectedVehicleForBooking.id,
                  seats: selectedSeats.length,
                  idempotencyKey: bookingIdempotencyKey,
                },
              });
              throw new Error("OFFLINE_QUEUED");
            })();
        console.log("Booking response:", response);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bookings = (response as any).data.bookings || [];
        console.log("Parsed booking data:", { bookings: bookings.length });
        const vehicleLP =
          bookings[0]?.licensePlate || selectedVehicleForBooking.licensePlate;
        const bookedSeatsCount = bookings.length || selectedSeats.length;

        const failedPrints: number[] = [];
        for (const booking of bookings) {
          const ticketData: TicketData = {
            licensePlate:
              booking.licensePlate || selectedVehicleForBooking.licensePlate,
            destinationName: station.selected.destinationName,
            seatNumber: booking.seatNumber || 1,
            totalAmount: booking.totalAmount,
            basePrice: station.selected.basePrice || 0,
            ...bookingPrintStaffFields(booking, staffInfo),
            createdAt: booking.createdAt,
            stationName: "",
            routeName: "",
            firstTripOfDay: booking.firstTripOfDay === true,
          };
          try {
            await printBookingGuaranteed(
              ticketData,
              {
                bookingId: booking.id,
                idempotencyKeyBase: `booking-${booking.id}-${ticketData.seatNumber}-${bookingIdempotencyKey}`,
              },
              `seat #${booking.seatNumber}`,
            );
          } catch (err) {
            console.error(
              "Failed to print ticket after retries for booking:",
              booking.id,
              err,
            );
            failedPrints.push(booking.seatNumber || 0);
          }
        }
        const printError =
          failedPrints.length > 0
            ? new Error(`Tickets non imprimés: #${failedPrints.join(", #")}`)
            : null;

        let notificationMessage = `Réservation réussie: ${vehicleLP} - ${bookedSeatsCount} ticket${bookedSeatsCount === 1 ? "" : "s"}`;
        if (printError) {
          notificationMessage += ` (Erreur impression: ${printError.message || "Problème d'impression du ticket"})`;
        } else {
          notificationMessage += ` imprimé`;
        }

        showNotification(notificationMessage, printError ? "error" : "success");
      } else {
        console.log(
          "Creating booking by destination:",
          station.selected.destinationId,
          "seats:",
          selectedSeats.length,
        );
        const doRequest = async () =>
          createBookingByDestination({
            destinationId: station.selected!.destinationId,
            seats: selectedSeats.length,
            idempotencyKey: bookingIdempotencyKey,
            preferExactFit: true,
          });
        const response = isOnline()
          ? await doRequest()
          : await (async () => {
              const id = newActionId("offline");
              await enqueueOfflineAction({
                id,
                type: "createBookingByDestination",
                payload: {
                  destinationId: station.selected!.destinationId,
                  seats: selectedSeats.length,
                  idempotencyKey: bookingIdempotencyKey,
                  preferExactFit: true,
                },
              });
              throw new Error("OFFLINE_QUEUED");
            })();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = (response as any).data;

        const failedDestPrints: number[] = [];
        if (b) {
          const seatsBooked = b.seatsBooked || selectedSeats.length;
          const perSeatAmount = (b.totalAmount || 0) / seatsBooked;
          for (let i = 0; i < seatsBooked; i++) {
            const seatNum = (b.seatNumber || 1) + i;
            const ticketData: TicketData = {
              licensePlate: b.licensePlate || "Attribué automatiquement",
              destinationName: station.selected.destinationName,
              seatNumber: seatNum,
              totalAmount: perSeatAmount,
              basePrice: station.selected.basePrice || 0,
              ...bookingPrintStaffFields(b, staffInfo),
              createdAt: b.createdAt || new Date().toISOString(),
              stationName: "",
              routeName: "",
              firstTripOfDay: b.firstTripOfDay === true,
            };
            try {
              await printBookingGuaranteed(
                ticketData,
                {
                  bookingId: b.id,
                  idempotencyKeyBase: `dest-booking-${b.id}-${seatNum}-${bookingIdempotencyKey}`,
                },
                `seat #${seatNum}`,
              );
            } catch (err) {
              console.error("Failed to print ticket after retries:", err);
              failedDestPrints.push(seatNum);
            }
          }
        }

        const label = b?.licensePlate || "Attribué automatiquement";
        const msg = `Réservation réussie: ${label} - ${selectedSeats.length} ticket${selectedSeats.length === 1 ? "" : "s"} imprimé`;
        if (failedDestPrints.length > 0) {
          showNotification(
            msg + ` (Échec impression: #${failedDestPrints.join(", #")})`,
            "error",
          );
        } else {
          showNotification(msg, "success");
        }
      }

      await station.refreshQueueAndSummaries();
      setSelectedSeats([1]);

      console.log(
        `Successfully booked ${selectedSeats.length} seats for ${selectedVehicleForBooking?.licensePlate || "auto-selected vehicle"} on route ${station.selected.destinationName}`,
      );
    } catch (error) {
      console.error("Échec de la création de la réservation :", error);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw =
        (error as any)?.message ||
        "Échec de la création de la réservation. Veuillez réessayer.";
      if (raw === "OFFLINE_QUEUED") {
        showNotification(
          "Hors ligne: action mise en attente. Elle sera synchronisée dès que le réseau revient.",
          "success",
        );
      } else {
        showNotification(raw, "error");
      }
    } finally {
      setBookingLoading(false);
    }
  }, [
    station,
    selectedSeats.length,
    selectedVehicleForBooking,
    bookingLoading,
    staffInfo,
    showNotification,
    printBookingGuaranteed,
  ]);

  // ── Ghost mode ───────────────────────────────────────────────────────────
  const generateIdempotencyKey = useCallback(() => {
    try {
      return crypto.randomUUID();
    } catch {
      return `ghost-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
  }, []);

  const handleEnterGhostMode = useCallback(async () => {
    setIsGhostMode(true);
    setSelectedGhostDestination(null);
    await station.loadAllDestinations();
  }, [station]);

  const handleExitGhostMode = useCallback(() => {
    setIsGhostMode(false);
    setSelectedGhostDestination(null);
  }, []);

  const handleGhostDestinationSelect = useCallback(
    (destination: {
      id: string;
      name: string;
      basePrice: number;
      serviceFee: number;
      isActive: boolean;
    }) => {
      const summaryDestination: Summary = {
        destinationId: destination.id,
        destinationName: destination.name,
        totalVehicles: 0,
        totalSeats: 0,
        availableSeats: 0,
        basePrice: destination.basePrice,
        serviceFee: destination.serviceFee ?? 0.2,
      };
      setSelectedGhostDestination(summaryDestination);
    },
    [],
  );

  const handleGhostBooking = useCallback(async () => {
    if (!selectedGhostDestination || selectedSeats.length === 0) return;
    if (bookingLoading) return;

    if (ghostDebounceRef.current) {
      window.clearTimeout(ghostDebounceRef.current);
    }

    const seats = selectedSeats.length;
    const destinationId = selectedGhostDestination.destinationId;

    // Generate a fresh idempotency key per user press to avoid collapsing
    // multiple distinct ghost bookings with the same seat count to the first
    // booking on the backend.
    const idempotencyKey = generateIdempotencyKey();
    ghostLastActionRef.current = { idempotencyKey, destinationId, seats };

    console.log("[GhostBookingFlow] click", {
      destinationId,
      seats,
      idempotencyKey,
      online: isOnline(),
    });
    setBookingLoading(true);
    setGhostPrintFailed(false);

    ghostDebounceRef.current = window.setTimeout(async () => {
      let bookingsCreated = false;
      try {
        console.log("[GhostBookingFlow] create_request", {
          destinationId,
          seats,
          idempotencyKey,
        });
        if (!isOnline()) {
          const id = newActionId("offline");
          await enqueueOfflineAction({
            id,
            type: "createGhostBooking",
            payload: { destinationId, seats, idempotencyKey },
          });
          showNotification(
            "Hors ligne: réservation fantôme mise en attente (sync auto).",
            "success",
          );
          return;
        }
        const response = await createGhostBooking(
          destinationId,
          seats,
          idempotencyKey,
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bookings: any[] = (response as any).data?.bookings || [];

        if (bookings.length === 0) {
          throw new Error("Ghost booking response returned no bookings");
        }

        bookingsCreated = true;
        console.log("[GhostBookingFlow] create_response", {
          count: bookings.length,
          idempotencyKey,
        });

        const printerCfg = await printerService.getPrinterConfig();
        const printerId =
          printerCfg?.ip && printerCfg?.port
            ? `${printerCfg.ip}:${printerCfg.port}`
            : undefined;

        const lastBooking = bookings[bookings.length - 1];
        const ghostStaff = bookingPrintStaffFields(lastBooking, staffInfo);
        setLastGhostBookingForReprint({
          bookingId: lastBooking.id,
          seatNumber: lastBooking.seatNumber,
          destinationName: selectedGhostDestination.destinationName,
          totalAmount: lastBooking.totalAmount ?? 0,
          basePrice:
            selectedGhostDestination.basePrice || lastBooking.basePrice || 0,
          createdBy: ghostStaff.createdBy,
          staffFirstName: ghostStaff.staffFirstName,
          staffLastName: ghostStaff.staffLastName,
          createdAt: lastBooking.createdAt || new Date().toISOString(),
        });

        // Booking creation is idempotent on the backend; printing must NOT
        // be deduped across distinct user actions, so we use a fresh
        // print-request id here.
        const printRequestId = generateIdempotencyKey();
        const ghostFailedPrints: number[] = [];
        for (const booking of bookings) {
          const ticketData: TicketData = {
            licensePlate: "N/A",
            destinationName: selectedGhostDestination.destinationName,
            seatNumber: booking.seatNumber,
            totalAmount: booking.totalAmount ?? 0,
            basePrice:
              selectedGhostDestination.basePrice || booking.basePrice || 0,
            ...bookingPrintStaffFields(booking, staffInfo),
            createdAt: booking.createdAt || new Date().toISOString(),
            stationName: "",
            routeName: "",
          };

          console.log("[GhostBookingFlow] print_request", {
            bookingId: booking.id,
            seatNumber: booking.seatNumber,
            printerId,
          });
          try {
            if (!isOnline()) {
              const id = newActionId("offline");
              await enqueueOfflineAction({
                id,
                type: "printBookingTicket",
                payload: {
                  ticketData,
                  audit: { bookingId: booking.id, printerId },
                },
              });
            } else {
              await printBookingGuaranteed(
                ticketData,
                {
                  bookingId: booking.id,
                  printerId,
                  idempotencyKeyBase: `ghost-booking-${booking.id}-${booking.seatNumber}-${printRequestId}`,
                },
                `ghost seat #${booking.seatNumber}`,
              );
            }
            console.log("[GhostBookingFlow] print_result", {
              ok: true,
              bookingId: booking.id,
              seatNumber: booking.seatNumber,
            });
          } catch (err) {
            console.error("[GhostBookingFlow] print_error after retries", {
              bookingId: booking.id,
              err,
            });
            ghostFailedPrints.push(booking.seatNumber);
          }
        }

        if (ghostFailedPrints.length > 0) {
          setGhostPrintFailed(true);
          showNotification(
            `${bookings.length} réservation(s) créée(s), impression échouée: #${ghostFailedPrints.join(", #")}`,
            "error",
          );
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const seatNumbers = bookings
            .map((b: any) => `#${b.seatNumber}`)
            .join(", ");
          showNotification(
            `${bookings.length} ticket(s) fantôme(s) imprimé(s): ${seatNumbers} — ${selectedGhostDestination.destinationName}`,
            "success",
          );
        }

        setSelectedSeats([1]);
      } catch (error) {
        console.error("[GhostBookingFlow] error", error);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const message =
          (error as any)?.message ||
          "Échec de la création/impression de la réservation fantôme.";
        showNotification(message, "error");
        if (bookingsCreated) {
          setGhostPrintFailed(true);
        }
      } finally {
        setBookingLoading(false);
      }
    }, 400);
  }, [
    selectedGhostDestination,
    selectedSeats.length,
    bookingLoading,
    showNotification,
    printBookingGuaranteed,
    generateIdempotencyKey,
    staffInfo,
  ]);

  const handleReprintLastGhostTicket = useCallback(async () => {
    if (!lastGhostBookingForReprint) return;
    if (bookingLoading) return;
    setBookingLoading(true);
    try {
      const printerCfg = await printerService.getPrinterConfig();
      const printerId =
        printerCfg?.ip && printerCfg?.port
          ? `${printerCfg.ip}:${printerCfg.port}`
          : undefined;
      const ticketData: TicketData = {
        licensePlate: "N/A",
        destinationName: lastGhostBookingForReprint.destinationName,
        seatNumber: lastGhostBookingForReprint.seatNumber,
        totalAmount: lastGhostBookingForReprint.totalAmount,
        basePrice: lastGhostBookingForReprint.basePrice || 0,
        staffFirstName: lastGhostBookingForReprint.staffFirstName ?? "",
        staffLastName: lastGhostBookingForReprint.staffLastName ?? "",
        createdBy: lastGhostBookingForReprint.createdBy,
        createdAt: lastGhostBookingForReprint.createdAt,
        stationName: "",
        routeName: "",
      };
      console.log("[GhostBookingFlow] reprint_request", {
        bookingId: lastGhostBookingForReprint.bookingId,
        printerId,
      });
      await printBookingGuaranteed(
        ticketData,
        {
          bookingId: lastGhostBookingForReprint.bookingId,
          printerId,
          idempotencyKeyBase: `ghost-booking-reprint-${lastGhostBookingForReprint.bookingId}`,
        },
        `ghost reprint #${lastGhostBookingForReprint.seatNumber}`,
      );
      console.log("[GhostBookingFlow] reprint_result", {
        ok: true,
        bookingId: lastGhostBookingForReprint.bookingId,
      });
      setGhostPrintFailed(false);
      showNotification(
        `Réimpression réussie: Ticket #${lastGhostBookingForReprint.seatNumber}`,
        "success",
      );
    } catch (err) {
      console.error("[GhostBookingFlow] reprint_error", err);
      showNotification(
        "Échec de la réimpression. Vérifiez l’imprimante.",
        "error",
      );
    } finally {
      setBookingLoading(false);
    }
  }, [
    lastGhostBookingForReprint,
    bookingLoading,
    showNotification,
    printBookingGuaranteed,
  ]);

  // ── Cross-state effects (booking <-> queue sync) ─────────────────────────
  // 1. Keep booking target explicit: only the user's current click selects a vehicle.
  // Do not auto-restore previous localStorage selection on refresh/navigation.

  // 2. Default seat count to 1 once a vehicle is picked.
  useEffect(() => {
    if (
      selectedVehicleForBooking &&
      selectedSeats.length === 0 &&
      (selectedVehicleForBooking.availableSeats ?? 0) > 0
    ) {
      setSelectedSeats([1]);
    }
    // Selection-driven auto-default — only react to vehicle changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVehicleForBooking]);

  const isSelectedVehicleStillInQueue = useMemo(
    () =>
      !!selectedVehicleForBooking &&
      station.queue.some((q) => q.id === selectedVehicleForBooking.id),
    [selectedVehicleForBooking, station.queue],
  );

  // 3. Drop the selection if the vehicle has departed the queue.
  useEffect(() => {
    if (selectedVehicleForBooking && !isSelectedVehicleStillInQueue) {
      setSelectedVehicleForBooking(null);
      saveSelectedVehicle(null);
      setSelectedSeats([]);
    }
  }, [
    selectedVehicleForBooking,
    isSelectedVehicleStillInQueue,
    saveSelectedVehicle,
  ]);

  // 4. Default seat count to 1 once a destination is picked (no specific
  // vehicle).
  useEffect(() => {
    if (
      station.selected &&
      !selectedVehicleForBooking &&
      selectedSeats.length === 0 &&
      (station.selected.availableSeats ?? 0) > 0
    ) {
      setSelectedSeats([1]);
    }
    // Mirrors the original effect — destination-driven only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station.selected]);

  // ── Background offline-queue drain ───────────────────────────────────────
  useEffect(() => {
    const run = () =>
      processOfflineQueue(async (a) => {
        switch (a.type) {
          case "createBookingByQueueEntry":
            await createBookingByQueueEntry(a.payload);
            return;
          case "createBookingByDestination":
            await createBookingByDestination(a.payload);
            return;
          case "createGhostBooking":
            await createGhostBooking(
              a.payload.destinationId,
              a.payload.seats,
              a.payload.idempotencyKey,
            );
            return;
          case "printTalon":
            await printerService.printTalon(
              a.payload.ticketData,
              a.payload.audit,
            );
            return;
          case "printBookingTicket":
            await printerService.printBookingTicket(
              a.payload.ticketData,
              a.payload.audit,
            );
            return;
        }
      });
    const t = window.setInterval(run, 3000);
    window.addEventListener("online", run);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("online", run);
    };
  }, []);

  return {
    // Identity
    staffInfo,
    sensors,

    // Booking
    selectedSeats,
    setSelectedSeats,
    bookingLoading,
    setBookingLoading,
    selectedVehicleForBooking,
    setSelectedVehicleForBooking,
    isSelectedVehicleStillInQueue,
    handleSeatCountSelect,
    handleConfirmBooking,
    saveSelectedVehicle,

    // Reorder
    handleDragEnd,
    handleMoveUp,
    handleMoveDown,

    // Modals: add vehicle
    addVehicleModalOpen,
    setAddVehicleModalOpen,
    vehicleSearchQuery,
    setVehicleSearchQuery,
    searchResults,
    setSearchResults,
    loadingSearch,
    setLoadingSearch,
    selectedVehicle,
    setSelectedVehicle,
    vehicleAuthorizedStations,
    loadingVehicleStations,
    searchError,
    setSearchError,
    handleSearchInputChange,
    handleSelectVehicle,
    handleConfirmAddVehicle,

    // Ghost mode
    isGhostMode,
    setIsGhostMode,
    selectedGhostDestination,
    setSelectedGhostDestination,
    lastGhostBookingForReprint,
    ghostPrintFailed,
    handleEnterGhostMode,
    handleExitGhostMode,
    handleGhostDestinationSelect,
    handleGhostBooking,
    handleReprintLastGhostTicket,
  };
}

export type UsePosWorkflow = ReturnType<typeof usePosWorkflow>;
