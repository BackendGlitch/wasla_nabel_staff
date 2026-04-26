// posLogger emits structured, greppable lines for the POS execution layer.
//
// Format:   [wasla.pos] level=info event=<name> key1=val1 key2=val2 ...
//
// Why this format:
//   * Stable prefix so journalctl/loki can be filtered with a single regex.
//   * Key/value pairs make every metric (latency_ms, jobId, deviceErrno) a
//     first-class field — no parsing of free-form text required when we ship
//     these to a log aggregator.
//   * Plain console.* so it works identically in main process (stdout) and
//     renderer (DevTools) — no extra dependency, no transport setup.
//
// Levels mirror console:
//   info  — normal pipeline transitions (start/end of render, write, ack)
//   warn  — slow/recovered conditions (e.g. render > 500ms, ack retried)
//   error — terminal failures (USB write rejected, ack rejected by backend)

export type LogFields = Record<string, string | number | boolean | null | undefined>

const PREFIX = '[wasla.pos]'

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

function formatValue(v: string | number | boolean): string {
  if (typeof v === 'string') {
    // Quote values that contain whitespace or '=' so a downstream parser
    // can split safely. Keep simple alphanumerics unquoted for readability.
    if (v.length === 0) return '""'
    if (/[\s="]/.test(v)) return JSON.stringify(v)
    return v
  }
  return String(v)
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
