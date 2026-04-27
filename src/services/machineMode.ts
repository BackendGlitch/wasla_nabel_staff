// machineMode is the renderer-side accessor for the staff-machine identity
// surfaced by the Electron main process via window.wasla.getMachineInfo().
//
// Goals:
//   * Single source of truth for machineType/machineId across the app.
//   * Cached once; the underlying values are env-driven in main and do not
//     change at runtime, so a single IPC roundtrip is enough.
//   * In Electron, default machine type is POS (main) — provisional reads
//     match that before the IPC result arrives.
//   * Synchronous accessor for hot paths (HTTP header injection); async
//     ensure() for code paths that can await initialisation explicitly.

import type { WaslaMachineInfo, WaslaMachineType } from '../types/electron'

const BROWSER_FALLBACK: WaslaMachineInfo = {
  machineType: 'normal',
  machineId: '',
  printerDevice: '',
}

function isElectronWaslaAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.wasla
}

function provisionalInfo(): WaslaMachineInfo {
  if (isElectronWaslaAvailable()) {
    return { machineType: 'pos', machineId: '', printerDevice: '' }
  }
  return BROWSER_FALLBACK
}

let cached: WaslaMachineInfo | null = null
let inflight: Promise<WaslaMachineInfo> | null = null

// ensureMachineInfo() resolves the machine info, caching the result. Called
// once at app boot (best effort) so subsequent sync reads are instant.
export async function ensureMachineInfo(): Promise<WaslaMachineInfo> {
  if (cached) return cached
  if (inflight) return inflight
  if (!isElectronWaslaAvailable()) {
    cached = BROWSER_FALLBACK
    return cached
  }
  inflight = (async () => {
    try {
      const info = await window.wasla!.getMachineInfo()
      const normalized: WaslaMachineInfo = {
        machineType: info?.machineType === 'pos' ? 'pos' : 'normal',
        machineId: typeof info?.machineId === 'string' ? info.machineId : '',
        printerDevice: typeof info?.printerDevice === 'string' ? info.printerDevice : '',
      }
      cached = normalized
      return normalized
    } catch {
      cached = provisionalInfo()
      return cached
    } finally {
      inflight = null
    }
  })()
  return inflight
}

// Synchronous accessor for hot paths (e.g. fetch header injection). If the
// info is not yet cached, returns a provisional value (POS in Electron with
// wasla, otherwise normal) and ensureMachineInfo is kicked off in the
// background from App.
export function getMachineInfoSync(): WaslaMachineInfo {
  if (cached) return cached
  void ensureMachineInfo()
  return provisionalInfo()
}

export function getMachineType(): WaslaMachineType {
  return getMachineInfoSync().machineType
}

export function isPosMode(): boolean {
  return getMachineInfoSync().machineType === 'pos' && isElectronWaslaAvailable()
}

// Header constants — keep in sync with backend pkg/middleware/machine.go.
export const MACHINE_TYPE_HEADER = 'X-Wasla-Machine-Type'
export const MACHINE_ID_HEADER = 'X-Wasla-Machine-Id'

export function machineHeaders(): Record<string, string> {
  const info = getMachineInfoSync()
  const out: Record<string, string> = {
    [MACHINE_TYPE_HEADER]: info.machineType,
  }
  if (info.machineId) out[MACHINE_ID_HEADER] = info.machineId
  return out
}
