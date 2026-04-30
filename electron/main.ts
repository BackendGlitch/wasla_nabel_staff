import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } from 'electron'
import { autoUpdater } from 'electron-updater'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { posLog } from './posLogger'
import { describeWriteError, preflightCheck, type PrinterHealthResult } from './printerHealth'
import {
  discoverWindowsComPrinter,
  getPrinterBaudRate,
  isComPathPresent,
  isWindowsComPath,
  normalizeComPath,
  preflightComPath,
  writeBytesToCom,
} from './windowsSerialPrinter'
import {
  isWinusbDeviceId,
  parseWinusbId,
  preflightWinusb,
  writeBytesWinusb,
} from './windowsWinusbPrinter'
import { discoverLinuxUsblp } from './linuxUsblpPrinter'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
//
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let customerWin: BrowserWindow | null = null

type CustomerDisplayState = {
  title?: string
  line1?: string
  line2?: string
}

const CFD_SERIAL_PORTS = ['/dev/ttyS0', '/dev/ttyS1', '/dev/ttyS2', '/dev/ttyS3']
const cfdWriteQueue: Map<string, Promise<unknown>> = new Map()

function normalizePriceForCfd(state: CustomerDisplayState): string {
  const source = `${state.line2 || ''} ${state.line1 || ''}`
  const m = source.match(/(\d+(?:[.,]\d{1,3})?)/)
  if (!m) return '0.000'
  const n = Number(m[1].replace(',', '.'))
  if (!Number.isFinite(n)) return '0.000'
  return n.toFixed(3)
}

async function writePriceToCfdSerial(price: string): Promise<void> {
  if (process.platform !== 'linux') return
  const baud = String(process.env.WASLA_CFD_BAUD || '9600').trim() || '9600'
  // Default to the first serial port; writing to all ports can corrupt output.
  const selectedPort = String(process.env.WASLA_CFD_PORT || '/dev/ttyS0').trim() || '/dev/ttyS0'
  const targetPorts = CFD_SERIAL_PORTS.includes(selectedPort) ? [selectedPort] : [selectedPort, ...CFD_SERIAL_PORTS]
  const line = price.padStart(20, ' ').slice(-20)
  // Epson/compatible customer display line-2 command + fallback plain text.
  const payload = Buffer.concat([
    Buffer.from([0x0c]), // clear
    Buffer.from([0x1b, 0x51, 0x42]), // ESC Q B (write second line on many pole displays)
    Buffer.from(line, 'ascii'),
    Buffer.from('\r\n', 'ascii'),
  ])

  for (const port of targetPorts) {
    try {
      const previous = cfdWriteQueue.get(port) || Promise.resolve()
      let release: () => void = () => {}
      let fail: (_err: Error) => void = () => {}
      const next = new Promise<void>((resolve, reject) => {
        release = resolve
        fail = reject
      })
      const tail = next.catch(() => undefined)
      cfdWriteQueue.set(port, tail)
      try {
        await previous
        spawnSync(
          'stty',
          ['-F', port, baud, 'cs8', '-cstopb', '-parenb', '-ixon', '-ixoff', '-crtscts', '-echo', 'raw'],
          { stdio: 'ignore' },
        )
        const handle = await fs.promises.open(port, 'a')
        try {
          await handle.write(payload)
        } finally {
          await handle.close()
        }
        release()
      } catch (e) {
        fail(e as Error)
        continue
      } finally {
        if (cfdWriteQueue.get(port) === tail) cfdWriteQueue.delete(port)
      }
      // Stop at first successful write to avoid duplicate/mixed frames.
      return
    } catch {
      // Try next port.
    }
  }
}

function customerDisplayHtml(state: CustomerDisplayState): string {
  const esc = (s?: string) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  const title = esc(state.title || 'WASLA')
  const line1 = esc(state.line1 || 'Bienvenue')
  const line2 = esc(state.line2 || 'Merci')
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:;" />
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #001a27; color: #b9f6ca; font-family: Arial, sans-serif; }
      .wrap { height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 20px; text-align: center; }
      .title { color: #ffffff; font-size: 40px; font-weight: 700; letter-spacing: 1px; }
      .l1 { font-size: 48px; font-weight: 700; color: #ffffff; }
      .l2 { font-size: 42px; font-weight: 700; color: #7CFC98; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="title">${title}</div>
      <div class="l1">${line1}</div>
      <div class="l2">${line2}</div>
    </div>
  </body>
</html>`
}

function closeCustomerDisplay() {
  if (customerWin && !customerWin.isDestroyed()) customerWin.close()
  customerWin = null
}

function ensureCustomerDisplayWindow() {
  const displays = screen.getAllDisplays()
  if (displays.length < 2) {
    closeCustomerDisplay()
    return null
  }
  const target = displays[1]
  if (customerWin && !customerWin.isDestroyed()) return customerWin
  customerWin = new BrowserWindow({
    x: target.bounds.x,
    y: target.bounds.y,
    width: target.bounds.width,
    height: target.bounds.height,
    frame: false,
    fullscreen: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    kiosk: true,
    movable: false,
    resizable: false,
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  customerWin.on('closed', () => {
    customerWin = null
  })
  return customerWin
}

function updateCustomerDisplay(state: CustomerDisplayState) {
  const numericPrice = normalizePriceForCfd(state)
  void writePriceToCfdSerial(numericPrice)
  const w = ensureCustomerDisplayWindow()
  if (!w) return { ok: false, reason: 'no-second-display' }
  const html = customerDisplayHtml(state)
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  w.loadURL(dataUrl).catch(() => undefined)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Staff machine identity (POS vs normal)
// ---------------------------------------------------------------------------
//
// The renderer reads these values via `window.wasla.getMachineInfo()` and
// uses them to decide whether to render+ack via USB (POS) or fall through
// to the legacy backend_tcp /print endpoints (normal).
//
// Values can be overridden by env so one binary can still run in legacy mode:
//
//   STAFF_MACHINE_TYPE=normal         # use backend TCP printing (legacy)
//   STAFF_MACHINE_TYPE=pos|unset     # local USB / render+ack (default for staff kiosks)
//   STAFF_MACHINE_ID=<stable-id>     # default: os.hostname()
//   STAFF_PRINTER_DEVICE=...         # Linux: /dev/usb/lp0 (or set explicitly); unset = auto-pick /dev/usb/lp* | Windows: COM3 | winusb:VID:PID
//   STAFF_PRINTER_BAUD=9600          # serial baud for COM (ZKTeco often 9600; try 115200 if needed)
type MachineInfo = {
  machineType: 'pos' | 'normal'
  machineId: string
  printerDevice: string
}

function defaultPrinterDevice(): string {
  if (process.platform === 'linux') return '/dev/usb/lp0'
  return ''
}

/** Set during app startup on Windows when STAFF_PRINTER_DEVICE is not set. */
let windowsAutoCom = ''

/** Set on Linux (Ubuntu POS) when STAFF_PRINTER_DEVICE is not set—first `/dev/usb/lpN` found. */
let linuxAutoLp = ''

function getMachineInfo(): MachineInfo {
  const rawType = String(process.env.STAFF_MACHINE_TYPE || '').toLowerCase().trim()
  // Default: POS (no env on the PC). Set STAFF_MACHINE_TYPE=normal for legacy Ethernet printing.
  const machineType: 'pos' | 'normal' = rawType === 'normal' ? 'normal' : 'pos'
  const machineId = String(process.env.STAFF_MACHINE_ID || '').trim() || os.hostname()
  const envDevice = String(process.env.STAFF_PRINTER_DEVICE || '').trim()
  let printerDevice = envDevice
  if (!printerDevice && process.platform === 'win32') {
    printerDevice = windowsAutoCom
  }
  if (!printerDevice && process.platform === 'linux') {
    printerDevice = linuxAutoLp
  }
  if (!printerDevice) {
    printerDevice = defaultPrinterDevice()
  }
  return { machineType, machineId, printerDevice }
}

let cachedMachineInfo: MachineInfo | null = null

function machineInfo(): MachineInfo {
  if (!cachedMachineInfo) cachedMachineInfo = getMachineInfo()
  return cachedMachineInfo
}

// Write raw ESC/POS bytes to the configured device. Used by the renderer's
// /render -> USB -> /ack flow for client_local print jobs.
//
// Strategy: open the device with append mode and write the buffer in one go.
// Append mode is the right semantics for character devices like /dev/usb/lp0
// and avoids truncating a real file if the path was misconfigured.
//
// We serialise concurrent writes to the same device with an in-process mutex
// (writeQueue): two near-simultaneous IPC calls would otherwise race on the
// underlying fd and produce interleaved ESC/POS bytes — i.e. corrupt prints,
// not duplicate prints, but still bad. The mutex is a per-device chain of
// pending writes; bursts are queued, never dropped.
const writeQueue: Map<string, Promise<unknown>> = new Map()

async function writeRawToDevice(device: string, buffer: Buffer): Promise<number> {
  if (!device) {
    throw new Error('STAFF_PRINTER_DEVICE is not set and no platform default is available')
  }
  if (process.platform === 'win32' && isWinusbDeviceId(device)) {
    const ids = parseWinusbId(device)
    if (!ids) {
      throw new Error('Invalid WinUSB id (use e.g. STAFF_PRINTER_DEVICE=winusb:0x0483:0x5743)')
    }
    const { vid, pid } = ids
    const key = `winusb:${vid}:${pid}`
    const previous = writeQueue.get(key) || Promise.resolve()
    let release: (value: number) => void = () => {}
    let fail: (err: Error) => void = () => {}
    const next = new Promise<number>((resolve, reject) => {
      release = resolve
      fail = reject
    })
    const tail = next.catch(() => undefined)
    writeQueue.set(key, tail)
    try {
      await previous
      const n = await writeBytesWinusb(device, vid, pid, buffer)
      release(n)
      return n
    } catch (e) {
      fail(e as Error)
      throw e
    } finally {
      if (writeQueue.get(key) === tail) {
        writeQueue.delete(key)
      }
    }
  }
  if (isWindowsComPath(device)) {
    const com = normalizeComPath(device)
    const baud = getPrinterBaudRate()
    const previous = writeQueue.get(com) || Promise.resolve()
    let release: (value: number) => void = () => {}
    let fail: (err: Error) => void = () => {}
    const next = new Promise<number>((resolve, reject) => {
      release = resolve
      fail = reject
    })
    const tail = next.catch(() => undefined)
    writeQueue.set(com, tail)
    try {
      await previous
      const n = await writeBytesToCom(com, buffer, baud)
      release(n)
      return n
    } catch (e) {
      fail(e as Error)
      throw e
    } finally {
      if (writeQueue.get(com) === tail) {
        writeQueue.delete(com)
      }
    }
  }
  const previous = writeQueue.get(device) || Promise.resolve()
  let release: (value: number) => void = () => {}
  let fail: (err: Error) => void = () => {}
  const next = new Promise<number>((resolve, reject) => {
    release = resolve
    fail = reject
  })
  const tail = next.catch(() => undefined)
  writeQueue.set(device, tail)
  try {
    await previous
    const handle = await fs.promises.open(device, 'a')
    try {
      const { bytesWritten } = await handle.write(buffer)
      release(bytesWritten)
      return bytesWritten
    } finally {
      await handle.close()
    }
  } catch (e) {
    fail(e as Error)
    throw e
  } finally {
    // If our promise is still the head of the queue, drop the reference so
    // GC can collect the chain when the burst is fully drained.
    if (writeQueue.get(device) === tail) {
      writeQueue.delete(device)
    }
  }
}

let cachedHealth: PrinterHealthResult | null = null

async function refreshPrinterHealth(): Promise<PrinterHealthResult> {
  // On Windows with auto-detect mode, refresh COM choice on every health poll
  // so unplug/replug events are reflected quickly in the UI.
  if (process.platform === 'win32' && !String(process.env.STAFF_PRINTER_DEVICE || '').trim()) {
    windowsAutoCom = await discoverWindowsComPrinter()
    cachedMachineInfo = null
  }
  if (process.platform === 'linux' && !String(process.env.STAFF_PRINTER_DEVICE || '').trim()) {
    linuxAutoLp = await discoverLinuxUsblp()
    cachedMachineInfo = null
  }
  const info = machineInfo()
  if (process.platform === 'win32' && isWinusbDeviceId(info.printerDevice)) {
    const ids = parseWinusbId(info.printerDevice)
    if (!ids) {
      cachedHealth = {
        device: info.printerDevice,
        status: 'unknown-error',
        error: 'Invalid winusb:VID:PID (example: winusb:0x0483:0x5743)',
        durationMs: 0,
      }
      return cachedHealth
    }
    cachedHealth = await preflightWinusb(info.printerDevice, ids.vid, ids.pid)
    return cachedHealth
  }
  if (process.platform === 'win32' && isWindowsComPath(info.printerDevice)) {
    cachedHealth = await preflightComPath(info.printerDevice, getPrinterBaudRate())
    return cachedHealth
  }
  cachedHealth = await preflightCheck(info.printerDevice)
  return cachedHealth
}

function registerWaslaIPC() {
  // wasla:get-machine-info — synchronous-style metadata fetch (cached).
  ipcMain.handle('wasla:get-machine-info', () => {
    const info = machineInfo()
    posLog.info('machine-info', {
      machineType: info.machineType,
      machineId: info.machineId,
      printerDevice: info.printerDevice,
    })
    return info
  })

  // wasla:check-printer — re-runs preflight on demand. Useful for an
  // operator-facing "Tester l'imprimante" button (kiosk UI, later phase)
  // and for stress scripts that need to confirm device health between runs.
  ipcMain.handle('wasla:check-printer', async () => refreshPrinterHealth())
  ipcMain.handle('wasla:customer-display-update', async (_event, payload: CustomerDisplayState) =>
    updateCustomerDisplay(payload || {}),
  )

  // wasla:print-bytes — write base64-decoded ESC/POS bytes to the local
  // USB printer. Always returns a structured result instead of throwing so
  // the renderer can ack the backend with a precise error message.
  ipcMain.handle(
    'wasla:print-bytes',
    async (_event, payload: { contentBase64: string; deviceOverride?: string; jobId?: string }) => {
      const start = Date.now()
      const jobId = payload?.jobId || ''
      try {
        if (!payload || typeof payload.contentBase64 !== 'string' || !payload.contentBase64) {
          posLog.error('usb-write', { jobId, ok: false, error: 'contentBase64 is required', duration_ms: Date.now() - start })
          return { ok: false, error: 'contentBase64 is required' }
        }
        const info = machineInfo()
        let device = (payload.deviceOverride && payload.deviceOverride.trim()) || info.printerDevice
        if (!device) {
          const error =
            process.platform === 'win32'
              ? 'no printer device (set STAFF_PRINTER_DEVICE=COM3 or winusb:0x0483:0x5743 with Zadig WinUSB)'
              : 'no printer device configured (set STAFF_PRINTER_DEVICE, e.g. /dev/usb/lp0)'
          posLog.error('usb-write', { jobId, ok: false, error, duration_ms: Date.now() - start })
          return { ok: false, error }
        }
        if (isWindowsComPath(device)) {
          const present = await isComPathPresent(device)
          if (!present) {
            if (!String(process.env.STAFF_PRINTER_DEVICE || '').trim()) {
              windowsAutoCom = await discoverWindowsComPrinter()
              cachedMachineInfo = null
            }
            const refreshed = machineInfo().printerDevice
            if (!refreshed || !(await isComPathPresent(refreshed))) {
              const error = `${normalizeComPath(device)} is not present (printer disconnected or COM changed)`
              posLog.error('usb-write', { jobId, ok: false, device, error, duration_ms: Date.now() - start })
              return { ok: false, error }
            }
            device = refreshed
          }
        }
        const buffer = Buffer.from(payload.contentBase64, 'base64')
        if (buffer.length === 0) {
          const error = 'decoded content is empty'
          posLog.error('usb-write', { jobId, ok: false, device, error, duration_ms: Date.now() - start })
          return { ok: false, error }
        }
        posLog.info('usb-write-start', { jobId, device, bytes: buffer.length })
        const bytesWritten = await writeRawToDevice(device, buffer)
        const duration = Date.now() - start
        posLog.info('usb-write', { jobId, ok: true, device, bytes: bytesWritten, duration_ms: duration })
        return { ok: true, bytesWritten, device, durationMs: duration }
      } catch (e) {
        const err = e as NodeJS.ErrnoException
        const info = machineInfo()
        const device = (payload?.deviceOverride && payload.deviceOverride.trim()) || info.printerDevice
        const error = isWinusbDeviceId(device) || isWindowsComPath(device)
          ? (err as Error).message || 'USB write failed'
          : describeWriteError(err, device)
        const duration = Date.now() - start
        posLog.error('usb-write', { jobId, ok: false, device, errno: err.code || 'UNKNOWN', error, duration_ms: duration })
        return { ok: false, error, errno: err.code, durationMs: duration }
      }
    },
  )
}

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC!, 'icons', 'icon-256x256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  })

  win.setFullScreen(true)

  win.on('minimize', (event: Electron.Event) => {
    event.preventDefault()
    win?.hide()
  })
  win.on('close', (event: Electron.Event) => {
    if (process.platform === 'win32' || process.platform === 'linux') {
      event.preventDefault()
      win?.hide()
    }
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

let tray: Tray | null = null

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(async () => {
  app.commandLine.appendSwitch('disable-web-security')
  app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor')

  if (process.platform === 'win32' && !String(process.env.STAFF_PRINTER_DEVICE || '').trim()) {
    windowsAutoCom = await discoverWindowsComPrinter()
    cachedMachineInfo = null
  }
  if (process.platform === 'linux' && !String(process.env.STAFF_PRINTER_DEVICE || '').trim()) {
    linuxAutoLp = await discoverLinuxUsblp()
    cachedMachineInfo = null
  }

  const info = machineInfo()
  posLog.info('boot', {
    machineType: info.machineType,
    machineId: info.machineId,
    printerDevice: info.printerDevice,
    appVersion: app.getVersion(),
    platform: process.platform,
  })

  registerWaslaIPC()

  // Run a printer preflight on POS machines so misconfigurations surface
  // in the journal before the first booking attempt. On normal machines we
  // skip the check entirely — they print over Ethernet via the backend.
  if (info.machineType === 'pos') {
    try {
      await refreshPrinterHealth()
    } catch (e) {
      posLog.error('preflight-exception', { error: (e as Error).message })
    }
  }

  createWindow()
  // Show default message when customer display exists.
  updateCustomerDisplay({ title: 'WASLA', line1: 'Bienvenue', line2: 'Merci' })
  screen.on('display-added', () => {
    updateCustomerDisplay({ title: 'WASLA', line1: 'Bienvenue', line2: 'Merci' })
  })
  screen.on('display-removed', () => {
    ensureCustomerDisplayWindow()
  })

  try {
    const iconPath = path.join(process.env.VITE_PUBLIC!, 'icons', 'icon-256x256.png')
    const trayIcon = nativeImage.createFromPath(iconPath)
    tray = new Tray(trayIcon)
    tray.setToolTip('Wasla')
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Afficher', click: () => { win?.show(); win?.focus() } },
      { label: 'Quitter', click: () => { tray?.destroy(); app.quit() } },
    ])
    tray.setContextMenu(contextMenu)
    tray.on('click', () => {
      win?.show()
      win?.focus()
    })
  } catch (e) {
    console.warn('Tray icon init failed (non-fatal):', e)
  }

  if (process.platform === 'win32') {
    const isAlreadySet = app.getLoginItemSettings().openAtLogin
    if (!isAlreadySet) {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath,
        args: [],
        name: 'Wasla',
      })
    }
  }

  setupAutoUpdater()
})

function setupAutoUpdater() {
  ipcMain.handle('get-app-version', () => app.getVersion())

  if (VITE_DEV_SERVER_URL) {
    ipcMain.handle('check-for-updates', async () => ({ success: false, error: 'Auto-update non disponible en mode développement' }))
    ipcMain.handle('download-update', async () => ({ success: false, error: 'Auto-update non disponible en mode développement' }))
    ipcMain.handle('install-update', async () => ({ success: false, error: 'Auto-update non disponible en mode développement' }))
    return
  }

  try {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    // GitHub Actions builds are not Authenticode-signed; the embedded app-update.yml
    // still contains publisherName, so verification would block every update. Skip
    // until you ship signed installers (then remove this and keep publisherName).
    if (process.platform === 'win32') {
      // NsisUpdater (Windows) supports this; default AppUpdater typings omit it
      const nsis = autoUpdater as typeof autoUpdater & {
        verifyUpdateCodeSignature: (fn: (publisherNames: string[], file: string) => Promise<string | null>) => void
      }
      nsis.verifyUpdateCodeSignature = async () => null
    }

    setInterval(() => {
      autoUpdater.checkForUpdates().catch((err) => console.error('Error checking for updates:', err))
    }, 4 * 60 * 60 * 1000)

    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => console.error('Error checking for updates on startup:', err))
    }, 2000)

    autoUpdater.on('update-available', (info) => {
      win?.webContents.send('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      })
    })
    autoUpdater.on('update-not-available', (info) => {
      win?.webContents.send('update-not-available', { version: info.version })
    })
    autoUpdater.on('error', (err: Error) => {
      win?.webContents.send('update-error', { message: err.message })
    })
    autoUpdater.on('download-progress', (progress) => {
      win?.webContents.send('update-download-progress', {
        percent: Math.round(progress.percent),
        transferred: progress.transferred,
        total: progress.total,
      })
    })
    autoUpdater.on('update-downloaded', (info) => {
      win?.webContents.send('update-downloaded', { version: info.version })
    })

    ipcMain.handle('check-for-updates', async () => {
      try {
        const result = await autoUpdater.checkForUpdates()
        return { success: true, updateInfo: result?.updateInfo }
      } catch (error) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    })
    ipcMain.handle('download-update', async () => {
      try {
        autoUpdater.downloadUpdate()
        return { success: true }
      } catch (error) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    })
    ipcMain.handle('install-update', async () => {
      try {
        // NSIS: silent install (/S) is required for a reliable headless update flow.
        autoUpdater.quitAndInstall(true, true)
        return { success: true }
      } catch (error) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    })
  } catch (e) {
    console.error('Failed to init autoUpdater', e)
  }
}
