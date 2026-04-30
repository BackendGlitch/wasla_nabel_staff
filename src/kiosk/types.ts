/**
 * Domain types shared across kiosk hooks, screens and components.
 *
 * These types intentionally mirror the shapes returned by the queue / booking
 * APIs so that the kiosk surface can be refactored without touching the API
 * client. The legacy `MainPage.tsx` declared identical types inline; they are
 * promoted here so multiple consumers can depend on them.
 */

export type Summary = {
  destinationId: string;
  destinationName: string;
  totalVehicles: number;
  totalSeats: number;
  availableSeats: number;
  basePrice: number;
  serviceFee: number;
};

export type QueueEntry = {
  id: string;
  vehicleId: string;
  licensePlate: string;
  availableSeats: number;
  totalSeats: number;
  queuePosition: number;
  bookedSeats: number;
  status?: string;
  hasTripsToday?: boolean;
};

export type Destination = {
  id: string;
  name: string;
  basePrice: number;
  serviceFee: number;
  isActive: boolean;
};

export type TodayTicketsByDestination = Record<
  string,
  { regularCountToday: number; ghostCountToday: number; totalToday: number }
>;

export type NotificationKind = 'success' | 'error';

export type ToastNotification = {
  message: string;
  type: NotificationKind;
};

export type GhostBookingForReprint = {
  bookingId: string;
  seatNumber: number;
  destinationName: string;
  totalAmount: number;
  basePrice?: number;
  createdBy: string;
  staffFirstName?: string;
  staffLastName?: string;
  createdAt: string;
};
