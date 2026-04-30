import { API } from '../config';
import { printerIpConfigService, PrinterIpConfig } from './printerIpConfigService';
import { isPosMode, machineHeaders } from './machineMode';
import { renderAndPrintLocal } from './clientPrintBridge';

// Printer configuration interface
export interface PrinterConfig {
  id: string;
  name: string;
  ip: string;
  port: number;
  width: number;
  timeout: number;
  model: string;
  enabled: boolean;
  isDefault: boolean;
}

// Print job interface
export interface PrintJob {
  content: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  underline?: boolean;
  size?: 'normal' | 'double_height' | 'double_width' | 'quad';
  cut?: boolean;
  openCashDrawer?: boolean;
}

// Printer status interface
export interface PrinterStatus {
  connected: boolean;
  error?: string;
}

// Print job type enum
export enum PrintJobType {
  BOOKING_TICKET = 'booking_ticket',
  ENTRY_TICKET = 'entry_ticket',
  EXIT_TICKET = 'exit_ticket',
  DAY_PASS_TICKET = 'day_pass_ticket',
  EXIT_PASS_TICKET = 'exit_pass_ticket',
  TALON = 'talon',
  STANDARD_TICKET = 'standard_ticket',
  RECEIPT = 'receipt',
  QR_CODE = 'qr_code'
}

// Queued print job interface
export interface QueuedPrintJob {
  id: string;
  jobType: PrintJobType;
  content: string;
  staffName?: string;
  priority: number;
  createdAt: string;
  retryCount: number;
}

// Print queue status interface
export interface PrintQueueStatus {
  queueLength: number;
  isProcessing: boolean;
  lastPrintedAt?: string;
  failedJobs: number;
}

// 'rendered' is the new client_local intermediate state introduced by the POS
// flow: the backend has produced ESC/POS bytes and is waiting for the staff
// machine to ack the local USB write. Polling helpers treat it like a
// not-yet-final status, identical to 'printing' for backend_tcp jobs.
export type DurablePrintJobStatus = 'pending' | 'printing' | 'rendered' | 'printed' | 'failed';

export interface DurablePrintJobRecord {
  id: string;
  bookingId?: string;
  printerId: string;
  jobType: PrintJobType;
  status: DurablePrintJobStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  printedAt?: string;
}

// Ticket data interface
export interface TicketData {
  licensePlate: string;
  destinationName: string;
  seatNumber: number;
  totalAmount: number;
  createdBy: string;
  /** When createdBy is an id, pass the human name here (see backend TicketData). */
  createdByName?: string;
  createdAt: string;
  stationName: string;
  routeName: string;
  // Vehicle and pricing information
  vehicleCapacity?: number;  // Vehicle capacity for total amount calculation
  basePrice?: number;        // Base price per seat from route
  // Exit pass count for today
  exitPassCount?: number;    // Current count of exit passes for today
  // Branding (optional)
  brandName?: string;
  brandLogo?: string;
  // Company branding (mapped to backend fields)
  companyName?: string;
  companyLogo?: string;
  // Staff information
  staffFirstName?: string;
  staffLastName?: string;
  /** Until this vehicle’s first completed trip today (any route), talon shows a top-right * on every seat; afterwards false. */
  firstTripOfDay?: boolean;
  /** Day pass ticket: ISO timestamps from backend day-pass payload. */
  purchaseDate?: string;
  validFrom?: string;
  validUntil?: string;
}

export interface PrintAuditFields {
  bookingId?: string;
  printerId?: string;
  idempotencyKey?: string;
}

type EnqueuePrintResponse = { message?: string; jobId?: string };

// Printer service class
export class PrinterService {
  private baseUrl: string;
  private defaultBrandName: string = '';
  private defaultBrandLogoPath: string = '';

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setBranding(companyName: string, companyLogoUrl: string) {
    this.defaultBrandName = companyName;
    this.defaultBrandLogoPath = companyLogoUrl;
  }

  private normalizeLogoRef(logo?: string): string {
    const v = (logo || '').trim();
    if (!v) return '';
    // Backend logo loader expects filesystem-like path (e.g. /assets/company-logo.png),
    // not full http URL. Convert absolute URL to pathname.
    if (v.startsWith('http://') || v.startsWith('https://')) {
      try {
        const u = new URL(v);
        return u.pathname || '';
      } catch {
        return '';
      }
    }
    return v;
  }

  // Get printer configuration from local storage
  async getPrinterConfig(): Promise<PrinterIpConfig> {
    return printerIpConfigService.getConfig();
  }

  private async getStablePrinterId(): Promise<string | undefined> {
    try {
      const cfg = await this.getPrinterConfig();
      if (!cfg) return undefined;
      if (cfg.ip && cfg.port) return `${cfg.ip}:${cfg.port}`;
      return undefined;
    } catch {
      return undefined;
    }
  }

  // Update printer configuration
  async updatePrinterConfig(printerId: string, config: PrinterConfig): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/printer/config/${printerId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...machineHeaders(),
      },
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      throw new Error(`Failed to update printer config: ${response.statusText}`);
    }
  }

  // Test printer connection using local configuration
  async testPrinterConnection(): Promise<PrinterStatus> {
    return await printerIpConfigService.testPrinterConnection();
  }

  // Get print queue
  async getPrintQueue(): Promise<QueuedPrintJob[]> {
    const response = await fetch(`${this.baseUrl}/api/printer/queue`, { headers: { ...machineHeaders() } });
    if (!response.ok) {
      throw new Error(`Failed to get print queue: ${response.statusText}`);
    }
    return response.json();
  }

  // Get print queue status
  async getPrintQueueStatus(): Promise<PrintQueueStatus> {
    const response = await fetch(`${this.baseUrl}/api/printer/queue/status`, { headers: { ...machineHeaders() } });
    if (!response.ok) {
      throw new Error(`Failed to get print queue status: ${response.statusText}`);
    }
    return response.json();
  }

  // Durable print jobs (Postgres)
  async listDurablePrintJobs(limit: number = 50): Promise<DurablePrintJobRecord[]> {
    const response = await fetch(
      `${this.baseUrl}/api/printer/jobs?limit=${encodeURIComponent(String(limit))}`,
      { headers: { ...machineHeaders() } },
    );
    if (!response.ok) {
      throw new Error(`Failed to list print jobs: ${response.statusText}`);
    }
    const data = await response.json();
    return (data?.jobs || []) as DurablePrintJobRecord[];
  }

  async getDurablePrintJob(id: string): Promise<DurablePrintJobRecord> {
    const response = await fetch(
      `${this.baseUrl}/api/printer/jobs/${encodeURIComponent(id)}`,
      { headers: { ...machineHeaders() } },
    );
    if (!response.ok) {
      throw new Error(`Failed to get print job: ${response.statusText}`);
    }
    return response.json();
  }

  // Add print job to queue
  async addPrintJob(jobType: PrintJobType, content: string, staffName?: string, priority: number = 100): Promise<QueuedPrintJob> {
    const response = await fetch(`${this.baseUrl}/api/printer/queue/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...machineHeaders(),
      },
      body: JSON.stringify({
        jobType,
        content,
        staffName,
        priority,
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to add print job: ${response.statusText}`);
    }
    return response.json();
  }

  private withBranding(data: TicketData): TicketData {
    const normalizedDataLogo = this.normalizeLogoRef(data.companyLogo || data.brandLogo);
    const normalizedDefaultLogo = this.normalizeLogoRef(this.defaultBrandLogoPath);
    return {
      ...data,
      // Ensure brand fields are present with fallbacks
      brandName: data.brandName || this.defaultBrandName,
      brandLogo: normalizedDataLogo || normalizedDefaultLogo,
      // Map to backend fields
      companyName: data.companyName || data.brandName || this.defaultBrandName,
      companyLogo: normalizedDataLogo || normalizedDefaultLogo,
    };
  }

  // ---------------------------------------------------------------------------
  // Routing policy (POS USB vs backend Ethernet)
  // ---------------------------------------------------------------------------
  //
  // routeTicket is the single decision point that picks between the two
  // delivery modes for a given ticket print:
  //
  //   normal mode  -> POST /api/printer/print/<urlPath>     (legacy backend_tcp)
  //   pos mode     -> POST /api/printer/render/<typeKey>
  //                   + window.wasla.printRawBytes(...)
  //                   + POST /api/printer/jobs/:id/ack       (client_local)
  //
  // The contract returned to callers is identical (resolves to a jobId), so
  // existing UI code (waitForPrintJob, offline queue, etc.) keeps working.
  //
  // POS mode is only chosen when *both* are true:
  //   * isPosMode() — not STAFF_MACHINE_TYPE=normal, window.wasla is exposed
  //   * a valid render typeKey is provided
  //
  // Otherwise falls back to legacy /print/* (e.g. STAFF_MACHINE_TYPE=normal or
  // browser / management profile).
  private async routeTicket(
    ticketName: string,
    typeKey: 'booking' | 'entry' | 'exit' | 'daypass' | 'exitpass' | 'talon',
    urlPath: 'booking' | 'entry' | 'exit' | 'daypass' | 'exitpass' | 'talon',
    requirePrinterConfig: boolean,
    ticketData: TicketData,
    audit?: PrintAuditFields,
  ): Promise<string> {
    if (isPosMode()) {
      return this.renderAndPrintViaPOS(ticketName, typeKey, ticketData, audit);
    }
    return this.enqueueViaBackendTCP(ticketName, urlPath, requirePrinterConfig, ticketData, audit);
  }

  private async renderAndPrintViaPOS(
    ticketName: string,
    typeKey: 'booking' | 'entry' | 'exit' | 'daypass' | 'exitpass' | 'talon',
    ticketData: TicketData,
    audit?: PrintAuditFields,
  ): Promise<string> {
    // POS payload purposefully omits printerConfig (the backend ignores it
    // for /render endpoints) and printerId (the backend derives it from the
    // X-Wasla-Machine-Id header so two POS machines never collide).
    const payload = {
      bookingId: audit?.bookingId,
      idempotencyKey: audit?.idempotencyKey,
      ...this.withBranding(ticketData),
    };
    try {
      const result = await renderAndPrintLocal(this.baseUrl, {
        ticketTypePath: typeKey,
        payload,
      });
      return result.jobId;
    } catch (e) {
      const err = e as Error;
      throw new Error(`Failed to print ${ticketName} (POS): ${err.message || String(e)}`);
    }
  }

  private async enqueueViaBackendTCP(
    ticketName: string,
    urlPath: 'booking' | 'entry' | 'exit' | 'daypass' | 'exitpass' | 'talon',
    requirePrinterConfig: boolean,
    ticketData: TicketData,
    audit?: PrintAuditFields,
  ): Promise<string> {
    const printerConfig = await this.getPrinterConfig();
    if (requirePrinterConfig && !printerConfig) {
      throw new Error('Printer configuration not found. Please configure printer IP in settings.');
    }

    const response = await fetch(`${this.baseUrl}/api/printer/print/${urlPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...machineHeaders(),
      },
      body: JSON.stringify({
        bookingId: audit?.bookingId,
        printerId: audit?.printerId || (await this.getStablePrinterId()),
        idempotencyKey: audit?.idempotencyKey,
        ...this.withBranding(ticketData),
        printerConfig: printerConfig,
      }),
    });
    if (!response.ok) {
      try {
        const errorData = await response.json();
        throw new Error(`Failed to print ${ticketName}: ${errorData.error || response.statusText}`);
      } catch (e) {
        if (e instanceof Error && e.message.includes('Failed to print')) {
          throw e;
        }
        throw new Error(`Failed to print ${ticketName}: ${response.statusText || 'Unknown error'}`);
      }
    }
    const data = (await response.json().catch(() => ({}))) as EnqueuePrintResponse;
    if (!data?.jobId) throw new Error('Printer accepted request but did not return jobId');
    return data.jobId;
  }

  // Print booking ticket using local printer configuration
  async printBookingTicket(ticketData: TicketData, audit?: PrintAuditFields): Promise<void> {
    await this.enqueueBookingTicket(ticketData, audit);
  }

  async enqueueBookingTicket(ticketData: TicketData, audit?: PrintAuditFields): Promise<string> {
    return this.routeTicket('booking ticket', 'booking', 'booking', true, ticketData, audit);
  }

  // Print entry ticket using local printer configuration
  async printEntryTicket(ticketData: TicketData, audit?: PrintAuditFields): Promise<void> {
    await this.enqueueEntryTicket(ticketData, audit);
  }

  async enqueueEntryTicket(ticketData: TicketData, audit?: PrintAuditFields): Promise<string> {
    // entry ticket has historically tolerated a missing printer config (legacy
    // behaviour: would fail at the backend instead of the frontend); preserve.
    return this.routeTicket('entry ticket', 'entry', 'entry', false, ticketData, audit);
  }

  // Print exit ticket using local printer configuration
  async printExitTicket(ticketData: TicketData, audit?: PrintAuditFields): Promise<void> {
    await this.enqueueExitTicket(ticketData, audit);
  }

  async enqueueExitTicket(ticketData: TicketData, audit?: PrintAuditFields): Promise<string> {
    return this.routeTicket('exit ticket', 'exit', 'exit', false, ticketData, audit);
  }

  // Print day pass ticket using local printer configuration
  async printDayPassTicket(ticketData: TicketData, audit?: PrintAuditFields): Promise<void> {
    await this.enqueueDayPassTicket(ticketData, audit);
  }

  async enqueueDayPassTicket(ticketData: TicketData, audit?: PrintAuditFields): Promise<string> {
    return this.routeTicket('day pass ticket', 'daypass', 'daypass', true, ticketData, audit);
  }

  // Print exit pass ticket using local printer configuration
  async printExitPassTicket(ticketData: TicketData, audit?: PrintAuditFields): Promise<void> {
    await this.enqueueExitPassTicket(ticketData, audit);
  }

  async enqueueExitPassTicket(ticketData: TicketData, audit?: PrintAuditFields): Promise<string> {
    return this.routeTicket('exit pass ticket', 'exitpass', 'exitpass', true, ticketData, audit);
  }

  // Print talon using local printer configuration
  async printTalon(ticketData: TicketData, audit?: PrintAuditFields): Promise<void> {
    await this.enqueueTalon(ticketData, audit);
  }

  async enqueueTalon(ticketData: TicketData, audit?: PrintAuditFields): Promise<string> {
    return this.routeTicket('talon', 'talon', 'talon', true, ticketData, audit);
  }

  async waitForPrintJob(
    jobId: string,
    opts?: { timeoutMs?: number; pollMs?: number },
  ): Promise<DurablePrintJobRecord> {
    const timeoutMs = opts?.timeoutMs ?? 20000;
    const pollMs = opts?.pollMs ?? 500;
    const start = Date.now();
    while (true) {
      const job = await this.getDurablePrintJob(jobId);
      if (job.status === 'printed' || job.status === 'failed') return job;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Print job timeout after ${timeoutMs}ms (jobId=${jobId})`);
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  // Helper method to create ticket data from booking
  createTicketDataFromBooking(booking: any, vehicle: any, destination: any, staffName: string, staffFirstName?: string, staffLastName?: string): TicketData {
    const fromApi = typeof booking?.createdByName === 'string' ? booking.createdByName.trim() : ''
    const fn = (staffFirstName || '').trim()
    const ln = (staffLastName || '').trim()
    const jwtName = `${fn} ${ln}`.trim()
    const technicalLogin = (s: string) => {
      const low = s.toLowerCase()
      return low.includes('staff_supervisor') || (!s.includes(' ') && low.startsWith('staff_'))
    }
    const resolvedName = jwtName || (fromApi && !technicalLogin(fromApi) ? fromApi : '')
    const displayBy = resolvedName || staffName || 'Agent'
    return {
      licensePlate: vehicle?.licensePlate || 'Unknown',
      destinationName: destination?.name || 'Unknown Destination',
      seatNumber: booking?.seatNumber || 1,
      totalAmount: booking?.totalAmount || 0,
      basePrice: destination?.basePrice || vehicle?.basePrice || 0, // Include base price from destination or vehicle
      createdBy: displayBy,
      createdByName: resolvedName || undefined,
      createdAt: booking?.createdAt || new Date().toISOString(),
      stationName: 'Station Name', // You might want to get this from context
      routeName: destination?.name || 'Unknown Route',
      // Staff information
      staffFirstName: fn,
      staffLastName: ln,
      firstTripOfDay: booking?.firstTripOfDay === true,
    };
  }

  // Helper method to print ticket after booking
  async printTicketAfterBooking(booking: any, vehicle: any, destination: any, staffName: string, staffFirstName?: string, staffLastName?: string): Promise<void> {
    const ticketData = this.createTicketDataFromBooking(booking, vehicle, destination, staffName, staffFirstName, staffLastName);
    // Directly print a talon containing plate, seat index, timestamp
    const talonData: TicketData = {
      licensePlate: ticketData.licensePlate,
      destinationName: ticketData.destinationName,
      seatNumber: ticketData.seatNumber,
      totalAmount: ticketData.totalAmount,
      basePrice: ticketData.basePrice, // Include base price for talon
      createdBy: ticketData.createdBy,
      createdByName: ticketData.createdByName,
      createdAt: booking?.createdAt || new Date().toISOString(),
      stationName: ticketData.stationName,
      routeName: ticketData.routeName,
      staffFirstName: staffFirstName || '',
      staffLastName: staffLastName || '',
      firstTripOfDay: ticketData.firstTripOfDay,
    };
    await this.printTalon(talonData, { bookingId: booking?.id });
  }
}

// Create a singleton instance
export const printerService = new PrinterService(API.printer);