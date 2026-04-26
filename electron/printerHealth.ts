// printerHealth diagnoses the local USB printer device the renderer will
// use through wasla:print-bytes. Two roles:
//
//   1. preflightCheck() — runs once at startup so the operator sees an
//      explicit "[wasla.pos] event=preflight ..." line in the journal
//      *before* the first print attempt. If permissions are wrong we want
//      that on the screen, not buried inside a failed booking.
//
//   2. describeWriteError() — translates errno codes from fs.* into the
//      one-line, actionable strings the renderer will eventually surface
//      to the user (e.g. "permission denied — add user to lp group").
//
// Everything here is best-effort and never throws: a degraded preflight
// must not prevent the app from launching, since the operator may still
// want to use the management features that don't require printing.

import fs from 'node:fs'
import { posLog } from './posLogger'

export type PrinterHealthStatus = 'ok' | 'missing' | 'unreadable' | 'unwritable' | 'not-character-device' | 'unknown-error'

export interface PrinterHealthResult {
  device: string
  status: PrinterHealthStatus
  error?: string
  isCharacterDevice?: boolean
  durationMs: number
}

const ERRNO_HINTS: Record<string, string> = {
  ENOENT: 'device not found — is the printer connected and powered on?',
  EACCES: 'permission denied — add the run user to the "lp" group, or set a udev rule',
  EBUSY: 'device is busy — another process holds an exclusive handle',
  ENXIO: 'device not ready — printer may be offline or out of paper',
  EIO: 'I/O error — check USB cable and printer health',
  ENODEV: 'no such device — driver not loaded or printer disconnected',
}

export function describeWriteError(err: NodeJS.ErrnoException, device: string): string {
  const code = err.code || 'UNKNOWN'
  const hint = ERRNO_HINTS[code]
  if (hint) return `${code} on "${device}": ${hint}`
  return `${code} on "${device}": ${err.message || 'unknown error'}`
}

// preflightCheck performs non-destructive checks against `device`:
//   * existence
//   * is it a character device (real /dev/usb/lp0 should be)
//   * readable + writable for the current process
//
// IMPORTANT: we DO NOT actually open the device for writing here, because
// some thermal printers reset on every open/close cycle. Existence + access
// mode are enough to surface the common misconfigurations.
export async function preflightCheck(device: string): Promise<PrinterHealthResult> {
  const start = Date.now()
  if (!device) {
    const result: PrinterHealthResult = {
      device,
      status: 'missing',
      error: 'STAFF_PRINTER_DEVICE is not set and no platform default applies',
      durationMs: Date.now() - start,
    }
    posLog.warn('preflight', { device, status: result.status, error: result.error, duration_ms: result.durationMs })
    return result
  }

  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(device)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    const status: PrinterHealthStatus = err.code === 'ENOENT' ? 'missing' : 'unknown-error'
    const result: PrinterHealthResult = {
      device,
      status,
      error: describeWriteError(err, device),
      durationMs: Date.now() - start,
    }
    posLog.warn('preflight', { device, status, error: result.error, duration_ms: result.durationMs })
    return result
  }

  const isCharacterDevice = stat.isCharacterDevice()
  if (!isCharacterDevice) {
    posLog.warn('preflight', {
      device,
      status: 'not-character-device',
      duration_ms: Date.now() - start,
      hint: 'path resolves to a regular file — likely misconfigured STAFF_PRINTER_DEVICE',
    })
    return {
      device,
      status: 'not-character-device',
      isCharacterDevice: false,
      error: 'path is not a character device (looks like a regular file)',
      durationMs: Date.now() - start,
    }
  }

  try {
    await fs.promises.access(device, fs.constants.R_OK)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    posLog.error('preflight', {
      device,
      status: 'unreadable',
      error: describeWriteError(err, device),
      duration_ms: Date.now() - start,
    })
    return {
      device,
      status: 'unreadable',
      isCharacterDevice,
      error: describeWriteError(err, device),
      durationMs: Date.now() - start,
    }
  }

  try {
    await fs.promises.access(device, fs.constants.W_OK)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    posLog.error('preflight', {
      device,
      status: 'unwritable',
      error: describeWriteError(err, device),
      duration_ms: Date.now() - start,
    })
    return {
      device,
      status: 'unwritable',
      isCharacterDevice,
      error: describeWriteError(err, device),
      durationMs: Date.now() - start,
    }
  }

  const result: PrinterHealthResult = {
    device,
    status: 'ok',
    isCharacterDevice,
    durationMs: Date.now() - start,
  }
  posLog.info('preflight', { device, status: result.status, duration_ms: result.durationMs })
  return result
}
