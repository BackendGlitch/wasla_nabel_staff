// Windows-only: ZKTeco ZKP8003 and similar ESC/POS units usually enumerate as a
// virtual COM port. We use `serialport` (baud + 8N1) instead of raw fs writes.

import { posLog } from './posLogger'
import type { PrinterHealthResult } from './printerHealth'

type PortInfo = Awaited<ReturnType<typeof listPorts>>[number]

async function listPorts() {
  const { SerialPort } = await import('serialport')
  return SerialPort.list()
}

export function getPrinterBaudRate(): number {
  const raw = String(process.env.STAFF_PRINTER_BAUD || '9600').trim()
  const n = parseInt(raw, 10)
  if (Number.isFinite(n) && n > 0) return n
  return 9600
}

function norm(s: string | undefined | null): string {
  return String(s || '')
    .toLowerCase()
    .trim()
}

/** True if `device` is a Windows COM port name we should open via serialport. */
export function isWindowsComPath(device: string): boolean {
  if (process.platform !== 'win32' || !device) return false
  const d = device.replace(/\\\\/g, '\\')
  if (/^\\\\\.\\COM\d+$/i.test(d)) return true
  return /^COM\d+$/i.test(d.trim())
}

/** Normalize to COMn for node-serialport. */
export function normalizeComPath(device: string): string {
  const m = device.replace(/\\\\/g, '\\').match(/(COM\d+)/i)
  if (m) return m[1]!.toUpperCase()
  return device.trim()
}

function scorePort(p: PortInfo): number {
  const hay = [norm(p.manufacturer), norm(p.friendlyName), norm(p.pnpId), norm(p.path)].join(' ')
  let s = 0
  if (hay.includes('zkteco') || hay.includes('zkt ')) s += 100
  if (hay.includes('zkp') || hay.includes('thermal')) s += 40
  if (hay.includes('wch') || hay.includes('ch340') || hay.includes('ch341')) s += 30
  if (hay.includes('prolific') || hay.includes('pl2303')) s += 25
  if (hay.includes('ftdi') || hay.includes('ft232')) s += 25
  if (hay.includes('silicon labs') || hay.includes('cp210')) s += 25
  if (hay.includes('usb') && (hay.includes('serial') || hay.includes('com'))) s += 20
  if (p.path) s += 1
  return s
}

/**
 * Picks a likely USB–serial COM port for ESC/POS when STAFF_PRINTER_DEVICE is unset.
 */
export async function discoverWindowsComPrinter(): Promise<string> {
  if (process.platform !== 'win32') return ''
  try {
    const ports = await listPorts()
    if (ports.length === 0) {
      posLog.warn('win-serial', { event: 'discover', found: 0, message: 'no serial ports' })
      return ''
    }
    const ranked = ports
      .map((p) => ({ p, s: scorePort(p) }))
      .sort((a, b) => b.s - a.s)
    const best = ranked[0]!
    const path = normalizeComPath(best.p.path || '')
    const candidatesSummary = ports
      .map((x) => `${x.path}(${scorePort(x)}:${String(x.manufacturer || '').slice(0, 24)})`)
      .join('; ')
    posLog.info('win-serial', { event: 'discover', picked: path, score: best.s, candidates: candidatesSummary })
    return path
  } catch (e) {
    posLog.error('win-serial', { event: 'discover-error', error: (e as Error).message })
    return ''
  }
}

export async function writeBytesToCom(path: string, buffer: Buffer, baudRate: number): Promise<number> {
  const { SerialPort } = await import('serialport')
  const com = normalizeComPath(path)
  return new Promise((resolve, reject) => {
    const port = new SerialPort({
      path: com,
      baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      autoOpen: false,
    })
    const finish = (err?: Error) => {
      try {
        port.removeAllListeners()
      } catch {
        // ignore
      }
      if (port.isOpen) {
        port.close((cErr) => {
          if (err) reject(err)
          else if (cErr) reject(cErr)
          else resolve(buffer.length)
        })
      } else if (err) reject(err)
      else resolve(buffer.length)
    }
    port.once('error', (e: Error) => finish(e))
    port.open((openErr) => {
      if (openErr) return finish(openErr)
      port.write(buffer, (wErr) => {
        if (wErr) return finish(wErr)
        port.drain((dErr) => {
          if (dErr) return finish(dErr)
          return finish()
        })
      })
    })
  })
}

export async function preflightComPath(device: string, baudRate: number): Promise<PrinterHealthResult> {
  const start = Date.now()
  const com = normalizeComPath(device)
  if (!isWindowsComPath(com)) {
    return {
      device,
      status: 'unknown-error',
      error: 'not a Windows COM path',
      durationMs: Date.now() - start,
    }
  }
  try {
    const { SerialPort } = await import('serialport')
    await new Promise<void>((resolve, reject) => {
      const port = new SerialPort({
        path: com,
        baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        autoOpen: false,
      })
      port.open((openErr) => {
        if (openErr) {
          reject(openErr)
          return
        }
        port.close((closeErr) => {
          if (closeErr) reject(closeErr)
          else resolve()
        })
      })
    })
    const result: PrinterHealthResult = { device: com, status: 'ok', durationMs: Date.now() - start }
    posLog.info('win-serial-preflight', { path: com, status: 'ok', duration_ms: result.durationMs })
    return result
  } catch (e) {
    const err = e as Error
    const result: PrinterHealthResult = {
      device: com,
      status: 'unknown-error',
      error: err.message || 'failed to open COM port',
      durationMs: Date.now() - start,
    }
    posLog.warn('win-serial-preflight', { path: com, status: 'error', error: result.error, duration_ms: result.durationMs })
    return result
  }
}
