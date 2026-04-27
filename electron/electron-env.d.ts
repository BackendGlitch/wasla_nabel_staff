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
    /** Raw device path used by wasla:print-bytes. Defaults to /dev/usb/lp0 on linux. */
    STAFF_PRINTER_DEVICE?: string
  }
}

interface Window {
  ipcRenderer: import('electron').IpcRenderer
}
