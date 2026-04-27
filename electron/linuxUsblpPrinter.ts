/**
 * Ubuntu / Linux: Epson TM-style thermal printers on USB typically bind as
 * `/dev/usb/lp0`, `lp1`, ... (usblp / usblp0 driver). No Windows-style driver
 * is required; the app opens the character device in append mode and writes
 * raw ESC/POS.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Picks the lowest-numbered `/dev/usb/lpN` node if present, else `''`.
 * Call when `STAFF_PRINTER_DEVICE` is not set to improve plug-and-play on POS.
 */
export async function discoverLinuxUsblp(): Promise<string> {
  let names: string[]
  try {
    names = await fs.readdir('/dev/usb')
  } catch {
    return ''
  }
  const lp = names
    .filter((n) => /^lp\d+$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.slice(2), 10) || 0
      const nb = parseInt(b.slice(2), 10) || 0
      return na - nb
    })
  if (lp.length === 0) return ''
  return path.join('/dev/usb', lp[0]!)
}
