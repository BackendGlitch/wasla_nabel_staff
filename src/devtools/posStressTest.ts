// posStressTest is the renderer-side stress harness for the POS pipeline.
// Unlike scripts/pos-render-stress.mjs (which only exercises the network +
// DB layer), this harness drives the *full* /render -> USB -> /ack chain
// because it runs inside the Electron renderer with access to window.wasla.
//
// USAGE FROM DEVTOOLS CONSOLE:
//
//   await posStressTest.checkPrinter()
//     -> runs preflight, prints health to console
//
//   await posStressTest.smoke()
//     -> 1 successful talon print (verifies happy path)
//
//   await posStressTest.idempotent()
//     -> N concurrent prints with the same idempotencyKey
//        asserts: only ONE physical print, all callers get the same jobId
//
//   await posStressTest.burst({ n: 10, concurrency: 3 })
//     -> N unique prints under concurrency, prints latency percentiles
//
//   await posStressTest.failure()
//     -> drives /render then sets a fake device path so USB write fails
//        asserts: backend records `failed`, no paper produced after preflight
//
// ACCEPTANCE NOTES (manual, observed at the printer):
//   * smoke()       -> exactly 1 receipt comes out
//   * idempotent()  -> exactly 1 receipt comes out (NOT N)
//   * burst()       -> N receipts, no interleaved garbage
//   * failure()     -> 0 receipts, console shows usb error + ack ok=false
//
// All scenarios log structured `[wasla.pos]` lines so the operator can grep
// the same correlation ids in the journalctl output of the Electron main.

import { API } from '../config'
import { ensureMachineInfo, machineHeaders } from '../services/machineMode'
import { renderAndPrintLocal } from '../services/clientPrintBridge'
import { posLog, nowMs } from '../services/posLogger'
import type { WaslaPrinterHealth } from '../types/electron'

interface SmokeResult {
  jobId: string
  ok: boolean
  totalMs: number
  renderMs?: number
  usbMs?: number
  ackMs?: number
}

interface BurstSummary {
  n: number
  concurrency: number
  okCount: number
  failCount: number
  elapsedMs: number
  throughputJobsPerSec: number
  total: { p50: number; p95: number; p99: number; max: number; mean: number }
  render: { p50: number; p95: number; p99: number; max: number; mean: number }
  usb: { p50: number; p95: number; p99: number; max: number; mean: number }
  ack: { p50: number; p95: number; p99: number; max: number; mean: number }
}

function nextKey(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`
    }
  } catch {
    // fall through
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function makeTalonPayload(idempotencyKey: string, seq: number): Record<string, unknown> {
  return {
    idempotencyKey,
    licensePlate: `STRESS-${seq.toString().padStart(4, '0')}`,
    destinationName: 'STRESS DEST',
    seatNumber: 1,
    totalAmount: 1.5,
    basePrice: 1.5,
    createdBy: 'pos-stress-renderer',
    createdAt: new Date().toISOString(),
    stationName: 'STRESS STATION',
    routeName: 'STRESS ROUTE',
    staffFirstName: 'Stress',
    staffLastName: 'Bot',
    brandName: 'Stress',
    companyName: 'Stress',
  }
}

function pct(values: number[]): { p50: number; p95: number; p99: number; max: number; mean: number } {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0, mean: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
  const sum = sorted.reduce((acc, v) => acc + v, 0)
  return {
    p50: at(50),
    p95: at(95),
    p99: at(99),
    max: sorted[sorted.length - 1],
    mean: Math.round((sum / sorted.length) * 100) / 100,
  }
}

async function runConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

async function checkPrinter(): Promise<WaslaPrinterHealth> {
  if (!window.wasla) throw new Error('window.wasla missing — not running inside Electron POS shell')
  const health = await window.wasla.checkPrinter()
  posLog.info('stress-checkPrinter', {
    device: health.device,
    status: health.status,
    error: health.error,
    duration_ms: health.durationMs,
  })
  // eslint-disable-next-line no-console
  console.table(health)
  return health
}

async function smoke(): Promise<SmokeResult> {
  if (!window.wasla) throw new Error('window.wasla missing — not running inside Electron POS shell')
  await ensureMachineInfo()
  const idemKey = nextKey('smoke')
  posLog.info('stress-smoke-start', { idemKey })
  const result = await renderAndPrintLocal(API.printer, {
    ticketTypePath: 'talon',
    payload: makeTalonPayload(idemKey, 0),
  })
  posLog.info('stress-smoke-end', {
    jobId: result.jobId,
    ok: true,
    duration_ms: result.totalMs,
    render_ms: result.renderMs,
    usb_ms: result.usbMs,
    ack_ms: result.ackMs,
  })
  return {
    jobId: result.jobId,
    ok: true,
    totalMs: result.totalMs,
    renderMs: result.renderMs,
    usbMs: result.usbMs,
    ackMs: result.ackMs,
  }
}

async function idempotent(opts?: { collisions?: number }): Promise<{ jobIds: string[]; uniqueCount: number; ok: boolean }> {
  const collisions = Math.max(2, opts?.collisions ?? 5)
  if (!window.wasla) throw new Error('window.wasla missing — not running inside Electron POS shell')
  await ensureMachineInfo()
  const idemKey = nextKey('idem')
  posLog.info('stress-idempotent-start', { idemKey, collisions })
  // Fire all callers in the same microtask so the renderer dedupe is what
  // resolves the race; if dedupe is broken the backend would still resolve
  // to the same jobId but multiple USB writes would hit the device.
  const promises = Array.from({ length: collisions }, (_, i) =>
    renderAndPrintLocal(API.printer, {
      ticketTypePath: 'talon',
      payload: makeTalonPayload(idemKey, i),
    }).catch((e) => ({ error: e instanceof Error ? e.message : String(e), jobId: '' as string, alreadyPrinted: false, totalMs: 0, correlationId: '' })),
  )
  const results = await Promise.all(promises)
  const jobIds = results.map((r) => ('jobId' in r ? r.jobId : ''))
  const uniqueCount = new Set(jobIds.filter(Boolean)).size
  const ok = uniqueCount === 1
  posLog.info('stress-idempotent-end', {
    idemKey,
    unique_jobIds: uniqueCount,
    ok,
    job_count: jobIds.length,
  })
  // eslint-disable-next-line no-console
  console.log('idempotent results:', { jobIds, uniqueCount, ok, results })
  return { jobIds, uniqueCount, ok }
}

async function burst(opts?: { n?: number; concurrency?: number }): Promise<BurstSummary> {
  const n = Math.max(1, opts?.n ?? 10)
  const concurrency = Math.max(1, opts?.concurrency ?? 3)
  if (!window.wasla) throw new Error('window.wasla missing — not running inside Electron POS shell')
  await ensureMachineInfo()
  posLog.info('stress-burst-start', { n, concurrency })

  const items = Array.from({ length: n }, (_, i) => ({
    seq: i,
    idemKey: nextKey('burst'),
  }))

  const totals: number[] = []
  const renders: number[] = []
  const usbs: number[] = []
  const acks: number[] = []
  let okCount = 0
  let failCount = 0

  const t0 = nowMs()
  await runConcurrent(items, concurrency, async (item) => {
    try {
      const r = await renderAndPrintLocal(API.printer, {
        ticketTypePath: 'talon',
        payload: makeTalonPayload(item.idemKey, item.seq),
      })
      okCount++
      totals.push(r.totalMs)
      if (r.renderMs !== undefined) renders.push(r.renderMs)
      if (r.usbMs !== undefined) usbs.push(r.usbMs)
      if (r.ackMs !== undefined) acks.push(r.ackMs)
    } catch (e) {
      failCount++
      posLog.error('stress-burst-job', { idemKey: item.idemKey, error: (e as Error).message })
    }
  })
  const elapsedMs = Math.round(nowMs() - t0)
  const summary: BurstSummary = {
    n,
    concurrency,
    okCount,
    failCount,
    elapsedMs,
    throughputJobsPerSec: Math.round(((okCount / elapsedMs) * 1000) * 100) / 100,
    total: pct(totals),
    render: pct(renders),
    usb: pct(usbs),
    ack: pct(acks),
  }
  posLog.info('stress-burst-end', {
    n,
    concurrency,
    ok: okCount,
    fail: failCount,
    elapsed_ms: elapsedMs,
    tput_per_sec: summary.throughputJobsPerSec,
    p95_total_ms: summary.total.p95,
    p99_total_ms: summary.total.p99,
  })
  // eslint-disable-next-line no-console
  console.log('burst summary:', summary)
  return summary
}

// failure() forces a USB write error by overriding the device path inside
// the IPC payload to a guaranteed-bad target. This validates that:
//   * the renderer captures the error
//   * the backend receives /ack ok=false
//   * no paper comes out
async function failure(): Promise<{ jobId: string; ackedFailure: boolean; error: string }> {
  if (!window.wasla) throw new Error('window.wasla missing — not running inside Electron POS shell')
  await ensureMachineInfo()
  const idemKey = nextKey('fail')
  posLog.info('stress-failure-start', { idemKey })

  // We deliberately call the lower-level pieces here so we can inject a
  // bad deviceOverride into printRawBytes — the bridge's renderAndPrintLocal
  // doesn't expose that knob (and shouldn't).
  const renderRes = await fetch(`${API.printer}/api/printer/render/talon`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...machineHeaders(),
    },
    body: JSON.stringify(makeTalonPayload(idemKey, 0)),
  })
  if (!renderRes.ok) throw new Error(`render failed: HTTP ${renderRes.status}`)
  const rendered = (await renderRes.json()) as { jobId: string; contentBase64: string }

  const usb = await window.wasla.printRawBytes({
    contentBase64: rendered.contentBase64,
    deviceOverride: '/dev/null/this-path-cannot-exist',
    jobId: rendered.jobId,
  })

  const ackRes = await fetch(`${API.printer}/api/printer/jobs/${encodeURIComponent(rendered.jobId)}/ack`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...machineHeaders(),
    },
    body: JSON.stringify({
      ok: false,
      error: usb.error || 'forced failure for stress test',
    }),
  })
  const ackOk = ackRes.ok
  posLog.info('stress-failure-end', {
    jobId: rendered.jobId,
    usb_ok: usb.ok,
    ack_ok: ackOk,
    error: usb.error,
  })
  return {
    jobId: rendered.jobId,
    ackedFailure: ackOk,
    error: usb.error || 'no error reported',
  }
}

export const posStressTest = {
  checkPrinter,
  smoke,
  idempotent,
  burst,
  failure,
}

declare global {
  interface Window {
    posStressTest?: typeof posStressTest
  }
}

// Self-register on the global so DevTools can call it directly. This is
// intentional: the harness has no UI, no auto-trigger, and no side effects
// at module load — it's just there to be invoked by an operator.
if (typeof window !== 'undefined') {
  window.posStressTest = posStressTest
}
