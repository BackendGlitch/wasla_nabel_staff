import { ipcRenderer, contextBridge } from 'electron'

// --------- Generic ipcRenderer bridge (kept for parity with management app) ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...rest) => listener(event, ...rest))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

// --------- Auto-updater bridge (existing surface used by the renderer) ---------
contextBridge.exposeInMainWorld('electronAPI', {
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  on: (channel: string, callback: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void) => {
    ipcRenderer.on(channel, callback)
  },
  off: (channel: string, callback: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, callback)
  },
  send: (channel: string, ...args: unknown[]) => {
    ipcRenderer.send(channel, ...args)
  },
})

// --------- Wasla bridge — POS-specific surface for USB printing ---------
//
// This is the *only* contract the renderer (printerService) uses to drive the
// local thermal printer. Keep the surface tiny so the renderer never imports
// anything from Node/Electron directly.
//
//   getMachineInfo() : machineType ("pos"|"normal"), machineId, printerDevice
//   printRawBytes()  : write base64 ESC/POS bytes to the configured device
//
// Non-staff / legacy: set STAFF_MACHINE_TYPE=normal in the environment. Staff kiosk
// build defaults to POS in main when unset.
contextBridge.exposeInMainWorld('wasla', {
  getMachineInfo: () => ipcRenderer.invoke('wasla:get-machine-info'),
  printRawBytes: (payload: { contentBase64: string; deviceOverride?: string; jobId?: string }) =>
    ipcRenderer.invoke('wasla:print-bytes', payload),
  checkPrinter: () => ipcRenderer.invoke('wasla:check-printer'),
})
