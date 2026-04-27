/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string

    /** `normal` = legacy backend TCP print. Omitted or `pos` = local USB (default in staff build). */
    STAFF_MACHINE_TYPE?: string
    /** Stable per-machine identifier. Defaults to os.hostname(). */
    STAFF_MACHINE_ID?: string
    /**
     * Raw path for wasla:print-bytes. Linux: `/dev/usb/lp0` (default) or the first
     * `lpN` from auto-discovery; Windows: `COMn` or `winusb:VID:PID` with Zadig.
     */
    STAFF_PRINTER_DEVICE?: string
    /** Baud rate for Windows COM (e.g. ZKTeco ZKP8003). Default 9600. */
    STAFF_PRINTER_BAUD?: string
  }
}

interface Window {
  ipcRenderer: import('electron').IpcRenderer
}
