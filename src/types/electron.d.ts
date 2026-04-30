// Electron IPC types for auto-updater
export interface ElectronAPI {
  checkForUpdates: () => Promise<{
    success: boolean;
    updateInfo?: any;
    error?: string;
  }>;
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
  installUpdate: () => Promise<{ success: boolean; error?: string }>;
  getAppVersion: () => Promise<string>;
  on: (channel: string, callback: (event: any, ...args: any[]) => void) => void;
  off: (
    channel: string,
    callback: (event: any, ...args: any[]) => void,
  ) => void;
  send: (channel: string, ...args: any[]) => void;
}

// Wasla POS bridge — exposed by electron/preload.ts. Only present when the
// app runs inside Electron; renderer code MUST tolerate it being undefined
// (browser dev mode, web build).
export type WaslaMachineType = "pos" | "normal";

export interface WaslaMachineInfo {
  machineType: WaslaMachineType;
  machineId: string;
  printerDevice: string;
}

export interface WaslaPrintResult {
  ok: boolean;
  bytesWritten?: number;
  device?: string;
  error?: string;
  errno?: string;
  durationMs?: number;
}

export type WaslaPrinterHealthStatus =
  | "ok"
  | "missing"
  | "unreadable"
  | "unwritable"
  | "not-character-device"
  | "unknown-error";

export interface WaslaPrinterHealth {
  device: string;
  status: WaslaPrinterHealthStatus;
  error?: string;
  isCharacterDevice?: boolean;
  durationMs: number;
}

export interface WaslaAPI {
  getMachineInfo: () => Promise<WaslaMachineInfo>;
  printRawBytes: (payload: {
    contentBase64: string;
    deviceOverride?: string;
    jobId?: string;
  }) => Promise<WaslaPrintResult>;
  checkPrinter: () => Promise<WaslaPrinterHealth>;
  updateCustomerDisplay: (payload: {
    title?: string;
    line1?: string;
    line2?: string;
  }) => Promise<{ ok: boolean; reason?: string }>;
  installCh341Driver: () => Promise<{ success: boolean; error?: string }>;
}

/** Exposed by electron/preload.ts (contextBridge `ipcRenderer`). */
export interface IpcRendererBridge {
  on: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void,
  ) => void;
  off: (channel: string, listener: (...args: unknown[]) => void) => void;
  send: (channel: string, ...args: unknown[]) => void;
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    wasla?: WaslaAPI;
    ipcRenderer?: IpcRendererBridge;
  }
}
