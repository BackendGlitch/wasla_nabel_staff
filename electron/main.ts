import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
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
//   STAFF_PRINTER_DEVICE=...         # default: /dev/usb/lp0 on Linux; on Windows, auto-pick a COM port
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

function getMachineInfo(): MachineInfo {
  const rawType = String(process.env.STAFF_MACHINE_TYPE || '').toLowerCase().trim()
  // Default: POS (no env on the PC). Set STAFF_MACHINE_TYPE=normal for legacy Ethernet printing.
  const machineType: 'pos' | 'normal' = rawType === 'normal' ? 'normal' : 'pos'
  const machineId = String(process.env.STAFF_MACHINE_ID || '').trim() || os.hostname()
  const envDevice = String(process.env.STAFF_PRINTER_DEVICE || '').trim()
  const printerDevice = envDevice || (process.platform === 'win32' ? windowsAutoCom : '') || defaultPrinterDevice()
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
  const info = machineInfo()
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
              ? 'no printer COM port (install the ZKTeco USB driver, then restart the app, or set STAFF_PRINTER_DEVICE=COM3)'
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
        const error = isWindowsComPath(device) ? (err as Error).message || 'COM write failed' : describeWriteError(err, device)
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
    if (process.platform === 'win32') {
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
    if (process.platform === 'win32') {
      const nsis = autoUpdater as typeof autoUpdater & {
        verifyUpdateCodeSignature: (fn: (publisherNames: string[], file: string) => Promise<string | null>) => void
      }
      nsis.verifyUpdateCodeSignature = async () => null
    }

    setInterval(() => {
      autoUpdater.checkForUpdates().catch((err) => console.error('check updates:', err))
    }, 4 * 60 * 60 * 1000)

    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => console.error('check updates startup:', err))
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
