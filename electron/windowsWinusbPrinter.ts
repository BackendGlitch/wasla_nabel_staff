/**
 * Windows + Zadig WinUSB: talk to the thermal printer via libusb (node `usb` +
 * `escpos-usb` adapter). No virtual COM port.
 *
 * Configure: STAFF_PRINTER_DEVICE=winusb:0x0483:0x5743
 * (VID/PID in hex or decimal, from Zadig / Device Manager.)
 */
import { createRequire } from 'node:module'
import type { PrinterHealthResult } from './printerHealth'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const usb = require('usb') as { findByIds: (vid: number, pid: number) => { open: () => void; close: () => void } | undefined }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const EscposUSB = require('escpos-usb') as new (vid: number, pid: number) => EscposUsbAdapter

type EscposUsbAdapter = {
  open(cb: (err: Error | null) => void): void
  write(data: Buffer, cb: (err: Error | null) => void): void
  close(cb?: (err: Error | null) => void): void
}

export function isWinusbDeviceId(s: string): boolean {
  return /^winusb:/i.test(String(s).trim())
}

/** Parse `winusb:0x0483:0x5743` or `winusb:1155:22339`. */
export function parseWinusbId(s: string): { vid: number; pid: number } | null {
  const m = String(s).trim().match(/^winusb:([^:]+):([^:]+)$/i)
  if (!m) return null
  const parse = (t: string) => {
    const x = t.trim()
    if (/^0x/i.test(x)) return parseInt(x, 16)
    return parseInt(x, 10)
  }
  const vid = parse(m[1]!)
  const pid = parse(m[2]!)
  if (!Number.isFinite(vid) || !Number.isFinite(pid) || vid <= 0 || pid <= 0) return null
  return { vid, pid }
}

function openWriteClose(vid: number, pid: number, buffer: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    let adapter: EscposUsbAdapter
    try {
      adapter = new EscposUSB(vid, pid)
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
      return
    }
    adapter.open((errOpen) => {
      if (errOpen) {
        reject(errOpen)
        return
      }
      adapter.write(buffer, (errWrite) => {
        if (errWrite) {
          try {
            adapter.close()
          } catch {
            /* ignore */
          }
          reject(errWrite)
          return
        }
        try {
          adapter.close((errClose) => {
            if (errClose) reject(errClose)
            else resolve(buffer.length)
          })
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      })
    })
  })
}

/**
 * Serialised raw ESC/POS write (open → bulk OUT → close per job so we never
 * keep the interface claimed across app idle).
 */
export async function writeBytesWinusb(
  _deviceId: string,
  vid: number,
  pid: number,
  buffer: Buffer,
): Promise<number> {
  return openWriteClose(vid, pid, buffer)
}

export async function preflightWinusb(deviceId: string, vid: number, pid: number): Promise<PrinterHealthResult> {
  const t0 = Date.now()
  const dev = usb.findByIds(vid, pid)
  if (!dev) {
    return {
      device: deviceId,
      status: 'missing',
      error: 'USB device not found (Zadig WinUSB installed? correct VID/PID?)',
      durationMs: Date.now() - t0,
    }
  }
  try {
    dev.open()
    dev.close()
    return { device: deviceId, status: 'ok', durationMs: Date.now() - t0 }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    return {
      device: deviceId,
      status: 'unwritable',
      error: `WinUSB: ${err}`,
      durationMs: Date.now() - t0,
    }
  }
}
