export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

import { API } from "@/config";
import { machineHeaders } from "@/services/machineMode";

let authToken: string | null = null;

// Optional global logout handler that the UI layer can register.
// This lets the HTTP client trigger a centralized logout flow (show message, redirect, etc.).
let onAuthLogout: ((reason?: string) => void) | null = null;

// Initialize auth token from localStorage on module load (for refresh persistence)
if (typeof window !== "undefined") {
  try {
    const saved = window.localStorage.getItem("authToken");
    if (saved) authToken = saved;
  } catch {}
}

export function setAuthToken(token: string | null) {
  authToken = token;
  if (typeof window !== "undefined") {
    try {
      if (token) {
        window.localStorage.setItem("authToken", token);
      } else {
        window.localStorage.removeItem("authToken");
      }
    } catch {}
  }
}

export function clearAuthToken() {
  setAuthToken(null);
}

export function setOnAuthLogout(handler: ((reason?: string) => void) | null) {
  onAuthLogout = handler;
}

export function getAuthToken() {
  return authToken;
}

/** JWT uses base64url; atob() alone often fails, leaving names empty. */
function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    const padded = b64 + (pad ? '='.repeat(4 - pad) : '');
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Populated on login in the kiosk / staff UI — use when JWT name claims are empty. */
function readStaffInfoFromLocalStorage(): { firstName: string; lastName: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('staffInfo');
    if (!raw) return null;
    const p = JSON.parse(raw) as { firstName?: string; lastName?: string };
    return {
      firstName: (p.firstName || '').trim(),
      lastName: (p.lastName || '').trim(),
    };
  } catch {
    return null;
  }
}

export function getStaffInfo() {
  const token = getAuthToken();
  if (!token) return null;
  const stored = readStaffInfoFromLocalStorage();
  const payload = parseJwtPayload(token);
  const staffId = (payload?.staff_id as string | undefined) || undefined;
  const jf = ((payload?.first_name as string) || (payload?.firstName as string) || '').trim();
  const jl = ((payload?.last_name as string) || (payload?.lastName as string) || '').trim();
  const firstName = jf || stored?.firstName || '';
  const lastName = jl || stored?.lastName || '';
  return { staffId, firstName, lastName };
}

async function request<T>(base: string, path: string, method: HttpMethod = "GET", body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...machineHeaders(),
  };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Handle unauthorized / expired sessions in a centralized place
  if (res.status === 401) {
    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch {
      bodyText = "";
    }

    const normalized = bodyText.toLowerCase();
    const isSessionError =
      normalized.includes("session expired") ||
      normalized.includes("session invalid") ||
      normalized.includes("expired or invalid");

    // Proactively clear token
    clearAuthToken();

    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem("authToken");
        window.localStorage.removeItem("staffInfo");
        window.localStorage.removeItem("selectedVehicleForBooking");
      } catch {}
    }

    if (onAuthLogout) {
      onAuthLogout(
        isSessionError
          ? "Session expirée, veuillez vous reconnecter."
          : "Session invalide, veuillez vous reconnecter."
      );
    }

    throw new Error(
      isSessionError
        ? "Session expirée, veuillez vous reconnecter."
        : `HTTP 401: ${bodyText || "Non autorisé"}`,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return (await res.json()) as T;
}

// Auth
export async function login(cin: string): Promise<{ data: { token: string; staff: { firstName: string; lastName: string } } }> {
  const r = await request<{ data: { token: string; staff: { firstName: string; lastName: string } } }>(API.auth, "/api/v1/auth/login", "POST", { cin });
  const token = r.data.token;
  setAuthToken(token);
  return r;
}

export async function logout(): Promise<void> {
  try {
    await request<unknown>(API.auth, "/api/v1/auth/logout", "POST");
  } catch {
    // Ignore logout failures; we'll still clear local state below.
  }

  clearAuthToken();

  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem("authToken");
      window.localStorage.removeItem("staffInfo");
      window.localStorage.removeItem("selectedVehicleForBooking");
    } catch {}
  }

  if (onAuthLogout) {
    onAuthLogout("Vous avez été déconnecté.");
  }
}

// Queue service
export async function listRoutes() {
  return request<{ data: Array<{ id: string; name: string; isActive?: boolean }> }>(API.queue, "/api/v1/routes");
}

export async function listVehicles() {
  return request<{ data: Array<{ id: string; licensePlate: string }> }>(API.queue, "/api/v1/vehicles");
}

export async function getVehicle(id: string) {
  return request<{ data: { id: string; licensePlate: string } }>(API.queue, `/api/v1/vehicles/${id}`);
}

export async function listQueue(destinationId: string) {
  return request<{ data: any[] }>(API.queue, `/api/v1/queue/${destinationId}`);
}

export async function listDayPasses() {
  return request<{ data: any[] }>(API.queue, "/api/v1/day-passes");
}

export async function listQueueSummaries(station?: string) {
  const url = station ? `/api/v1/queue-summaries?station=${encodeURIComponent(station)}` : "/api/v1/queue-summaries";
  return request<{ data: Array<{ destinationId: string; destinationName: string; totalVehicles: number; totalSeats: number; availableSeats: number; basePrice: number }> }>(API.queue, url);
}

export async function listRouteSummaries() {
  return request<{ data: Array<{ routeId: string; routeName: string; totalVehicles: number; totalSeats: number; availableSeats: number }> }>(API.queue, "/api/v1/route-summaries");
}

export async function reorderQueue(destinationId: string, entryIds: string[]) {
  return request<{ data: { entryIds: string[] } }>(API.queue, `/api/v1/queue/${destinationId}/reorder`, "PUT", { entryIds });
}

export async function deleteQueueEntry(destinationId: string, entryId: string) {
  return request<{ data: any }>(API.queue, `/api/v1/queue/${destinationId}/entry/${entryId}`, "DELETE");
}

export async function transferSeats(destinationId: string, fromEntryId: string, toEntryId: string, seats: number) {
  return request<{ data: any }>(API.queue, `/api/v1/queue/${destinationId}/transfer-seats`, "POST", { 
    fromEntryId, 
    toEntryId, 
    seats 
  });
}

// Printer service
export async function printExitPassAndRemove(printerId: string, payload: {
  queueEntryId: string;
  licensePlate: string;
  destinationName: string;
  bookedSeats: number;
  totalSeats: number;
  basePrice: number;
  createdBy: string;
  stationName?: string;
  routeName?: string;
  exitPassCount?: number;
  companyName?: string;
  companyLogo?: string;
  staffFirstName?: string;
  staffLastName?: string;
}) {
  return request<{ message: string }>(API.printer, `/api/printer/print/${printerId}/exitpass-and-remove`, "POST", payload);
}

export async function changeDestination(destinationId: string, entryId: string, newDestinationId: string, newDestinationName: string) {
  return request<{ data: any }>(API.queue, `/api/v1/queue/${destinationId}/entry/${entryId}/change-destination`, "PUT", {
    newDestinationId,
    newDestinationName
  });
}

export async function getVehicleAuthorizedRoutes(vehicleId: string) {
  return request<{ data: Array<{ id: string; stationId: string; stationName: string; priority: number; isDefault: boolean }> }>(API.queue, `/api/v1/vehicles/${vehicleId}/authorized-routes`);
}

export async function searchVehicles(query: string) {
  return request<{ data: Array<{ id: string; licensePlate: string; capacity: number; isActive: boolean; isAvailable: boolean }> }>(API.queue, `/api/v1/vehicles?search=${encodeURIComponent(query)}`);
}

export async function addVehicleToQueue(destinationId: string, vehicleId: string, destinationName: string) {
  return request<{ 
    data: { 
      queueEntry: any; 
      dayPass?: any;
      dayPassValid?: any;
      dayPassStatus: string;
    } 
  }>(API.queue, `/api/v1/queue/${destinationId}`, "POST", {
    vehicleId,
    destinationId,
    destinationName
  });
}

export async function getVehicleDayPass(vehicleId: string) {
  return request<{ data: any }>(API.queue, `/api/v1/day-pass/vehicle/${vehicleId}`);
}

export async function createBookingByDestination(payload: { destinationId: string; seats: number; idempotencyKey: string; subRoute?: string; preferExactFit?: boolean }) {
  return request<{ data: any }>(API.booking, "/api/v1/bookings", "POST", payload);
}

export async function createBookingByQueueEntry(payload: { queueEntryId: string; seats: number; idempotencyKey: string }) {
  return request<{ data: { 
    bookings: Array<{ 
      id: string; 
      queueId: string; 
      vehicleId: string; 
      licensePlate: string; 
      seatsBooked: number; 
      seatNumber: number; 
      totalAmount: number; 
      bookingStatus: string; 
      paymentStatus: string; 
      createdBy: string; 
      createdByName: string; 
      createdAt: string 
    }>;
    exitPass?: {
      id: string;
      queueId: string;
      vehicleId: string;
      licensePlate: string;
      destinationId: string;
      destinationName: string;
      previousVehicles: Array<{
        licensePlate: string;
        exitTime: string;
      }>;
      currentExitTime: string;
      totalPrice: number;
      createdBy: string;
      createdByName: string;
      createdAt: string;
    };
    hasExitPass: boolean;
  } }>(API.booking, "/api/v1/bookings/by-queue-entry", "POST", payload);
}

// Booking service

export async function cancelBooking(id: string) {
  return request<{ data: any }>(API.booking, `/api/v1/bookings/${id}/cancel`, "PUT");
}

export async function cancelOneBookingByQueueEntry(payload: { queueEntryId: string }) {
  return request<{ data: { id: string } }>(API.booking, "/api/v1/bookings/cancel-one-by-queue-entry", "POST", payload);
}

export async function listTrips() {
  return request<{ data: any[] }>(API.booking, "/api/v1/trips");
}

export async function listTodayTrips(search?: string) {
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';
  return request<{ data: Array<{ id: string; licensePlate: string; destinationName: string; startTime: string }> }>(API.booking, `/api/v1/trips/today${qs}`);
}

export async function getTodayTripsCountByLicensePlate(licensePlate: string) {
  return request<{ data: { count: number } }>(API.booking, `/api/v1/trips/count-by-license?license_plate=${encodeURIComponent(licensePlate)}`);
}

export async function healthAuth() {
  return fetch(`${API.auth}/health`).then((r) => ({ ok: r.ok }));
}
export async function healthQueue() {
  return fetch(`${API.queue}/health`).then((r) => ({ ok: r.ok }));
}
export async function healthBooking() {
  return fetch(`${API.booking}/health`).then((r) => ({ ok: r.ok }));
}
export async function healthWS() {
  return fetch(`${API.ws.replace('ws', 'http')}/health`).then((r) => ({ ok: r.ok }));
}

export interface InitData {
  station: { id: string; name: string; governorate: string; delegation: string; address: string; openingTime: string; closingTime: string; serviceFee: number };
  company: { name: string; logoUrl: string };
  destinations: Array<{ id: string; name: string; basePrice: number }>;
}

export async function fetchInit(): Promise<InitData> {
  const res = await fetch(`${API.queue}/api/v1/init`);
  if (!res.ok) throw new Error(`init failed: ${res.status}`);
  const body = await res.json();
  return body.data as InitData;
}

// Ghost booking functions
export async function createGhostBooking(destinationId: string, seats: number, idempotencyKey: string) {
  return request<{ data: any }>(API.booking, "/api/v1/bookings/ghost", "POST", {
    destinationId,
    seats,
    idempotencyKey,
  });
}

export async function getGhostBookingCount(destinationId: string) {
  return request<{ data: { count: number } }>(API.booking, `/api/v1/bookings/ghost/count?destination_id=${encodeURIComponent(destinationId)}`);
}

export interface TodayBookedTicketsByDestination {
  destinationId: string;
  regularCountToday: number;
  ghostCountToday: number;
  totalToday: number;
}

// Get today's booked tickets totals per destination (regular + ghost).
// If destinationId is provided, filters to one destination.
export async function getTodayBookedTicketsByDestination(destinationId?: string) {
  const qs = destinationId ? `?destination_id=${encodeURIComponent(destinationId)}` : '';
  return request<{ data: TodayBookedTicketsByDestination[] }>(
    API.booking,
    `/api/v1/bookings/today/tickets-by-destination${qs}`
  );
}

// Get all destinations from routes table
export async function getAllDestinations() {
  return request<{ data: Array<{ id: string; name: string; basePrice: number; isActive: boolean }> }>(API.queue, "/api/v1/destinations");
}
