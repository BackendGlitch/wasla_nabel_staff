// clientPrintBridge implements the POS-mode print pipeline:
//
//   1. POST /api/printer/render/:type    -> { jobId, contentBase64, alreadyPrinted }
//   2. window.wasla.printRawBytes(...)   -> writes ESC/POS to USB (or returns ok=false)
//   3. POST /api/printer/jobs/:id/ack    -> records the outcome on the backend
//
// All error cases are explicit. A backend render failure throws before any
// USB write is attempted. A USB write failure is reported to the backend via
// /ack ok=false and then re-thrown so the caller (printerService) can decide
// what to do (retry, surface to user, etc.).
//
// IMPORTANT: this module is only used when STAFF_MACHINE_TYPE=pos AND
// window.wasla is available. The router in printerService.routeTicket()
// guards both conditions; this module assumes them.

import { ensureMachineInfo, machineHeaders } from './machineMode'
import { posLog, nowMs } from './posLogger'
import type { WaslaPrintResult } from '../types/electron'

export interface RenderRequest {
  // The URL segment for /api/printer/render/:type (booking | entry | exit | daypass | exitpass | talon).
  ticketTypePath: 'booking' | 'entry' | 'exit' | 'daypass' | 'exitpass' | 'talon'
  // Full backend payload, identical to what the legacy /print/* endpoints accept,
  // minus printerConfig (ignored by the render endpoint).
  payload: Record<string, unknown>
}

export interface RenderAndPrintResult {
  jobId: string
  alreadyPrinted: boolean
  bytesWritten?: number
  device?: string
  // Per-stage timings (ms). Undefined when a stage was skipped (e.g. on
  // alreadyPrinted=true the USB and ack stages don't run a second time).
  renderMs?: number
  usbMs?: number
  ackMs?: number
  totalMs: number
  // Stable correlation id for log-grepping the full lifecycle of a print.
  // Identical to the backend jobId once /render returns; before that we
  // synthesize a transient id so every log line in the burst is correlatable.
  correlationId: string
}

function isElectronWaslaAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.wasla
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...machineHeaders(),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const data = await res.json()
      detail = data?.error || ''
    } catch {
      detail = await res.text().catch(() => '')
    }
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  return (await res.json()) as T
}

interface RenderResponse {
  jobId: string
  status: string
  contentBase64: string
  alreadyPrinted: boolean
  deliveryMode: string
}

interface AckResponse {
  message: string
  id: string
  ok: boolean
}

// ---------------------------------------------------------------------------
// In-flight idempotency dedupe
// ---------------------------------------------------------------------------
//
// Two near-simultaneous calls with the same idempotencyKey could otherwise
// race: both /render calls succeed with the same jobId (backend is
// idempotent), but both are still in `rendered` status when the second
// caller checks `alreadyPrinted`, so both would attempt a USB write and
// produce a duplicate paper print.
//
// We close that window in the renderer by sharing a single in-flight
// promise per idempotencyKey. The first caller drives the whole pipeline
// and every subsequent caller awaits the same result.
//
// Map is intentionally bound to the module (not the printerService
// instance) so even multiple instances of PrinterService — though we only
// have one today — would still dedupe correctly.
const inflight = new Map<string, Promise<RenderAndPrintResult>>()

function nextCorrelationId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `pos-${crypto.randomUUID().slice(0, 8)}`
    }
  } catch {
    // fall through
  }
  return `pos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * renderAndPrintLocal runs the full POS print pipeline against `printerBaseUrl`
 * (typically API.printer). Throws on any failure with a descriptive message.
 *
 * Concurrent calls with the same payload.idempotencyKey are deduplicated:
 * only one /render+/USB+/ack chain runs and all callers await the same result.
 */
export async function renderAndPrintLocal(
  printerBaseUrl: string,
  req: RenderRequest,
): Promise<RenderAndPrintResult> {
  if (!isElectronWaslaAvailable()) {
    throw new Error('clientPrintBridge: window.wasla is not available; falling back path should be used')
  }

  const idemKey = typeof req.payload?.idempotencyKey === 'string' ? req.payload.idempotencyKey : ''
  if (idemKey) {
    const existing = inflight.get(idemKey)
    if (existing) {
      posLog.info('inflight-dedupe', { idemKey, ticketType: req.ticketTypePath })
      return existing
    }
  }

  const promise = doRenderAndPrint(printerBaseUrl, req)
  if (idemKey) {
    inflight.set(idemKey, promise)
    promise.finally(() => {
      // Always clear on settle. Backend idempotency keeps the /render call
      // safe forever; renderer dedupe only protects the in-flight window.
      if (inflight.get(idemKey) === promise) {
        inflight.delete(idemKey)
      }
    })
  }
  return promise
}

async function doRenderAndPrint(
  printerBaseUrl: string,
  req: RenderRequest,
): Promise<RenderAndPrintResult> {
  const correlationId = nextCorrelationId()
  const t0 = nowMs()

  await ensureMachineInfo()

  // ---------- 1. /render ----------
  const renderStart = nowMs()
  posLog.info('render-start', {
    correlationId,
    ticketType: req.ticketTypePath,
    idemKey: typeof req.payload?.idempotencyKey === 'string' ? req.payload.idempotencyKey : undefined,
  })
  let rendered: RenderResponse
  try {
    rendered = await postJson<RenderResponse>(
      `${printerBaseUrl}/api/printer/render/${encodeURIComponent(req.ticketTypePath)}`,
      req.payload,
    )
  } catch (e) {
    const renderMs = Math.round(nowMs() - renderStart)
    posLog.error('render', { correlationId, ok: false, duration_ms: renderMs, error: (e as Error).message })
    throw e
  }
  const renderMs = Math.round(nowMs() - renderStart)
  if (!rendered?.jobId) {
    posLog.error('render', { correlationId, ok: false, duration_ms: renderMs, error: 'missing jobId' })
    throw new Error('render endpoint did not return a jobId')
  }
  posLog.info('render', {
    correlationId,
    jobId: rendered.jobId,
    ok: true,
    duration_ms: renderMs,
    alreadyPrinted: rendered.alreadyPrinted,
    bytes: rendered.contentBase64 ? rendered.contentBase64.length : 0,
  })
  if (renderMs > 500) {
    posLog.warn('render-slow', { correlationId, jobId: rendered.jobId, duration_ms: renderMs })
  }

  if (rendered.alreadyPrinted) {
    const totalMs = Math.round(nowMs() - t0)
    posLog.info('pipeline', {
      correlationId,
      jobId: rendered.jobId,
      ok: true,
      reused: true,
      duration_ms: totalMs,
    })
    return {
      jobId: rendered.jobId,
      alreadyPrinted: true,
      renderMs,
      totalMs,
      correlationId,
    }
  }

  if (!rendered.contentBase64) {
    posLog.error('render', { correlationId, jobId: rendered.jobId, ok: false, error: 'empty contentBase64' })
    throw new Error('render endpoint returned empty contentBase64')
  }

  // ---------- 2. USB write via Electron main ----------
  const usbStart = nowMs()
  let writeResult: WaslaPrintResult
  try {
    writeResult = await window.wasla!.printRawBytes({
      contentBase64: rendered.contentBase64,
      jobId: rendered.jobId,
    })
  } catch (e) {
    const err = e as Error
    writeResult = { ok: false, error: `IPC error: ${err.message || String(e)}` }
  }
  const usbMs = Math.round(nowMs() - usbStart)
  if (writeResult.ok) {
    posLog.info('usb', {
      correlationId,
      jobId: rendered.jobId,
      ok: true,
      duration_ms: usbMs,
      bytes: writeResult.bytesWritten ?? 0,
      device: writeResult.device,
    })
  } else {
    posLog.error('usb', {
      correlationId,
      jobId: rendered.jobId,
      ok: false,
      duration_ms: usbMs,
      errno: writeResult.errno,
      error: writeResult.error,
    })
  }

  // ---------- 3. /ack ----------
  const ackStart = nowMs()
  let ackError: Error | null = null
  try {
    await postJson<AckResponse>(
      `${printerBaseUrl}/api/printer/jobs/${encodeURIComponent(rendered.jobId)}/ack`,
      {
        ok: !!writeResult.ok,
        error: writeResult.ok ? undefined : writeResult.error || 'unknown USB error',
        printedAt: writeResult.ok ? new Date().toISOString() : undefined,
      },
    )
  } catch (e) {
    ackError = e as Error
  }
  const ackMs = Math.round(nowMs() - ackStart)
  if (ackError) {
    posLog.error('ack', { correlationId, jobId: rendered.jobId, ok: false, duration_ms: ackMs, error: ackError.message })
  } else {
    posLog.info('ack', {
      correlationId,
      jobId: rendered.jobId,
      ok: !!writeResult.ok,
      duration_ms: ackMs,
    })
  }

  const totalMs = Math.round(nowMs() - t0)

  if (ackError) {
    if (writeResult.ok) {
      posLog.error('pipeline', { correlationId, jobId: rendered.jobId, ok: false, duration_ms: totalMs, stage: 'ack-after-print' })
      throw new Error(`Printed locally but failed to ack backend: ${ackError.message}`)
    }
    posLog.error('pipeline', { correlationId, jobId: rendered.jobId, ok: false, duration_ms: totalMs, stage: 'ack-after-fail' })
    throw new Error(`Local print failed and ack also failed: ${writeResult.error}; ack: ${ackError.message}`)
  }

  if (!writeResult.ok) {
    posLog.error('pipeline', { correlationId, jobId: rendered.jobId, ok: false, duration_ms: totalMs, stage: 'usb' })
    throw new Error(`Local USB print failed: ${writeResult.error || 'unknown error'}`)
  }

  posLog.info('pipeline', {
    correlationId,
    jobId: rendered.jobId,
    ok: true,
    duration_ms: totalMs,
    renderMs,
    usbMs,
    ackMs,
    bytes: writeResult.bytesWritten ?? 0,
  })

  return {
    jobId: rendered.jobId,
    alreadyPrinted: false,
    bytesWritten: writeResult.bytesWritten,
    device: writeResult.device,
    renderMs,
    usbMs,
    ackMs,
    totalMs,
    correlationId,
  }
}
