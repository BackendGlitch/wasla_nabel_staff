// Renderer-side mirror of electron/posLogger.ts.
//
// Two copies (one per build target) is intentional — the Electron main
// process and the React renderer have different module graphs, and both
// need to stay dependency-free. The wire format is identical so logs from
// either side can be aggregated with the same `[wasla.pos]` filter.

export type LogFields = Record<string, string | number | boolean | null | undefined>

const PREFIX = '[wasla.pos]'

function formatValue(v: string | number | boolean): string {
  if (typeof v === 'string') {
    if (v.length === 0) return '""'
    if (/[\s="]/.test(v)) return JSON.stringify(v)
    return v
  }
  return String(v)
}

function fmt(level: 'info' | 'warn' | 'error', event: string, fields?: LogFields): string {
  const parts = [PREFIX, `level=${level}`, `event=${event}`]
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null) continue
      parts.push(`${k}=${formatValue(v)}`)
    }
  }
  return parts.join(' ')
}

export const posLog = {
  info(event: string, fields?: LogFields) {
    // eslint-disable-next-line no-console
    console.log(fmt('info', event, fields))
  },
  warn(event: string, fields?: LogFields) {
    // eslint-disable-next-line no-console
    console.warn(fmt('warn', event, fields))
  },
  error(event: string, fields?: LogFields) {
    // eslint-disable-next-line no-console
    console.error(fmt('error', event, fields))
  },
}

export function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}
