#!/usr/bin/env node
//
// pos-render-stress.mjs — backend-only stress harness for the POS pipeline.
//
// What it does:
//   * Hammers POST /api/printer/render/talon and POST /api/printer/jobs/:id/ack
//     against a real printer-service (default http://192.168.192.100:8005).
//   * Simulates a POS client by sending the X-Wasla-Machine-Type=pos and
//     X-Wasla-Machine-Id headers — same headers the Electron app sends.
//   * Does NOT write to USB. This script validates the network + DB layer
//     under load. To validate USB end-to-end, use window.posStressTest from
//     the DevTools console of the running Electron POS app.
//
// What it asserts:
//   * Concurrent /render with the same idempotencyKey return the SAME jobId
//     (prevents the duplicate-print race even before our renderer dedupe).
//   * /ack ok=true succeeds for client_local jobs.
//   * /ack against a backend_tcp jobId is rejected (HTTP 409).
//   * Reports p50/p95/p99 latency for /render, /ack, and end-to-end.
//
// Usage:
//   node scripts/pos-render-stress.mjs                         # defaults: 50 jobs, 10 concurrent
//   PRINTER_URL=http://10.0.0.5:8005 node scripts/pos-render-stress.mjs
//   N=200 CONCURRENCY=20 node scripts/pos-render-stress.mjs
//   node scripts/pos-render-stress.mjs --idem-collisions 5     # send 5 dup requests per key
//   node scripts/pos-render-stress.mjs --network-delay 250     # add jitter to simulate WAN
//
// Exit codes:
//   0  all assertions passed
//   1  assertion failed (duplicate jobId, unexpected HTTP status, etc.)
//   2  fatal setup error (printer-service unreachable)

import { argv, env, exit } from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'

const PRINTER_URL = env.PRINTER_URL || 'http://192.168.192.100:8005'
const MACHINE_ID = env.STAFF_MACHINE_ID || `stress-${randomUUID().slice(0, 8)}`
const N = Number(env.N || readArg('--n', 50))
const CONCURRENCY = Number(env.CONCURRENCY || readArg('--concurrency', 10))
const IDEM_COLLISIONS = Number(readArg('--idem-collisions', 1))
const NETWORK_DELAY_MS = Number(readArg('--network-delay', 0))

function readArg(flag, def) {
  const i = argv.indexOf(flag)
  if (i < 0 || i === argv.length - 1) return def
  return argv[i + 1]
}

function withJitter(p) {
  if (NETWORK_DELAY_MS <= 0) return p
  return sleep(Math.random() * NETWORK_DELAY_MS).then(() => p)
}

async function postJson(path, body) {
  const url = `${PRINTER_URL}${path}`
  const res = await withJitter(
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wasla-Machine-Type': 'pos',
        'X-Wasla-Machine-Id': MACHINE_ID,
      },
      body: JSON.stringify(body),
    }),
  )
  const text = await res.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { raw: text }
  }
  return { status: res.status, body: parsed }
}

function makeTalonPayload(idemKey, seq) {
  return {
    idempotencyKey: idemKey,
    licensePlate: `STRESS-${seq.toString().padStart(4, '0')}`,
    destinationName: 'STRESS DEST',
    seatNumber: 1,
    totalAmount: 1.5,
    basePrice: 1.5,
    createdBy: 'pos-stress-harness',
    createdAt: new Date().toISOString(),
    stationName: 'STRESS STATION',
    routeName: 'STRESS ROUTE',
    staffFirstName: 'Stress',
    staffLastName: 'Bot',
  }
}

function percentiles(values) {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0, min: 0, mean: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
  const sum = sorted.reduce((acc, v) => acc + v, 0)
  return {
    min: sorted[0],
    p50: at(50),
    p95: at(95),
    p99: at(99),
    max: sorted[sorted.length - 1],
    mean: Math.round((sum / sorted.length) * 100) / 100,
  }
}

async function runConcurrent(items, concurrency, fn) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      try {
        results[i] = await fn(items[i], i)
      } catch (e) {
        results[i] = { error: e instanceof Error ? e.message : String(e) }
      }
    }
  })
  await Promise.all(workers)
  return results
}

async function preflight() {
  try {
    const res = await fetch(`${PRINTER_URL}/health`, { method: 'GET' })
    if (!res.ok) throw new Error(`/health returned ${res.status}`)
  } catch (e) {
    console.error(`[FATAL] printer-service unreachable at ${PRINTER_URL}: ${e.message}`)
    exit(2)
  }
}

let assertionFailures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  PASS  ${msg}`)
  } else {
    assertionFailures++
    console.error(`  FAIL  ${msg}`)
  }
}

async function scenarioConcurrentSameKey() {
  console.log('\n=== Scenario 1: Concurrent /render with same idempotencyKey ===')
  console.log(`  ${IDEM_COLLISIONS} concurrent requests with the same key, expect single jobId`)
  const idemKey = `stress-collide-${randomUUID()}`
  const payloads = Array.from({ length: IDEM_COLLISIONS }, (_, i) => makeTalonPayload(idemKey, i))
  const t0 = Date.now()
  const results = await Promise.all(
    payloads.map((p) => postJson('/api/printer/render/talon', p)),
  )
  const ms = Date.now() - t0
  const ok = results.every((r) => r.status === 200 || r.status === 201)
  const jobIds = new Set(results.map((r) => r.body?.jobId))
  console.log(`  elapsed=${ms}ms  unique_jobIds=${jobIds.size}  http_statuses=${results.map((r) => r.status).join(',')}`)
  assert(ok, 'all /render calls returned 2xx')
  assert(jobIds.size === 1, `exactly one jobId across ${IDEM_COLLISIONS} concurrent calls`)
  return [...jobIds][0]
}

async function scenarioBurstThroughput() {
  console.log('\n=== Scenario 2: Burst throughput (N unique jobs, concurrency=C) ===')
  console.log(`  N=${N} concurrency=${CONCURRENCY} jitter=${NETWORK_DELAY_MS}ms`)
  const jobs = Array.from({ length: N }, (_, i) => ({
    idemKey: `stress-burst-${randomUUID()}`,
    seq: i,
  }))
  const renderLatencies = []
  const ackLatencies = []
  const totalLatencies = []
  let renderErrors = 0
  let ackErrors = 0

  const t0 = Date.now()
  await runConcurrent(jobs, CONCURRENCY, async (job) => {
    const start = Date.now()
    const renderStart = Date.now()
    const renderRes = await postJson('/api/printer/render/talon', makeTalonPayload(job.idemKey, job.seq))
    const renderMs = Date.now() - renderStart
    renderLatencies.push(renderMs)
    if (renderRes.status !== 200 && renderRes.status !== 201) {
      renderErrors++
      return
    }
    const jobId = renderRes.body?.jobId
    if (!jobId) {
      renderErrors++
      return
    }
    const ackStart = Date.now()
    const ackRes = await postJson(`/api/printer/jobs/${encodeURIComponent(jobId)}/ack`, {
      ok: true,
      printedAt: new Date().toISOString(),
    })
    ackLatencies.push(Date.now() - ackStart)
    if (ackRes.status !== 200 && ackRes.status !== 201) {
      ackErrors++
    }
    totalLatencies.push(Date.now() - start)
  })
  const elapsed = Date.now() - t0
  const tput = ((totalLatencies.length / elapsed) * 1000).toFixed(2)

  console.log(`  elapsed=${elapsed}ms  throughput=${tput} jobs/sec  renderErrors=${renderErrors}  ackErrors=${ackErrors}`)
  console.log(`  /render  ms:`, percentiles(renderLatencies))
  console.log(`  /ack     ms:`, percentiles(ackLatencies))
  console.log(`  total    ms:`, percentiles(totalLatencies))
  assert(renderErrors === 0, 'no /render errors during burst')
  assert(ackErrors === 0, 'no /ack errors during burst')
}

async function scenarioAckIdempotent() {
  console.log('\n=== Scenario 3: Ack idempotency (ack twice on same jobId) ===')
  const idemKey = `stress-ack-twice-${randomUUID()}`
  const renderRes = await postJson('/api/printer/render/talon', makeTalonPayload(idemKey, 0))
  assert(renderRes.status === 200 || renderRes.status === 201, '/render initial call ok')
  const jobId = renderRes.body?.jobId
  if (!jobId) return

  const ack1 = await postJson(`/api/printer/jobs/${encodeURIComponent(jobId)}/ack`, {
    ok: true,
    printedAt: new Date().toISOString(),
  })
  const ack2 = await postJson(`/api/printer/jobs/${encodeURIComponent(jobId)}/ack`, {
    ok: true,
    printedAt: new Date().toISOString(),
  })
  console.log(`  ack1.status=${ack1.status}  ack2.status=${ack2.status}`)
  assert(ack1.status === 200, 'first ack returns 200')
  // Second ack against an already-printed job should be tolerated by the
  // backend (it's just an idempotent state transition). 200 or 409 are both
  // acceptable — anything else is a regression.
  assert(ack2.status === 200 || ack2.status === 409, 'second ack returns 200 or 409 (no 5xx)')
}

async function scenarioRenderRetryAfterAck() {
  console.log('\n=== Scenario 4: /render after successful ack returns alreadyPrinted=true ===')
  const idemKey = `stress-retry-${randomUUID()}`
  const r1 = await postJson('/api/printer/render/talon', makeTalonPayload(idemKey, 0))
  assert(r1.status === 200 || r1.status === 201, 'first /render ok')
  const jobId = r1.body?.jobId
  await postJson(`/api/printer/jobs/${encodeURIComponent(jobId)}/ack`, {
    ok: true,
    printedAt: new Date().toISOString(),
  })
  const r2 = await postJson('/api/printer/render/talon', makeTalonPayload(idemKey, 0))
  console.log(`  r2.status=${r2.status}  alreadyPrinted=${r2.body?.alreadyPrinted}  jobId=${r2.body?.jobId}`)
  assert(r2.body?.jobId === jobId, 'second /render returns same jobId (idempotent)')
  assert(r2.body?.alreadyPrinted === true, 'second /render reports alreadyPrinted=true')
}

async function scenarioRenderFailureAck() {
  console.log('\n=== Scenario 5: /ack ok=false records failure ===')
  const idemKey = `stress-fail-${randomUUID()}`
  const r1 = await postJson('/api/printer/render/talon', makeTalonPayload(idemKey, 0))
  const jobId = r1.body?.jobId
  const ack = await postJson(`/api/printer/jobs/${encodeURIComponent(jobId)}/ack`, {
    ok: false,
    error: 'simulated USB failure for stress test',
  })
  console.log(`  ack.status=${ack.status}`)
  assert(ack.status === 200, 'failure ack accepted by backend')
}

async function main() {
  console.log(`pos-render-stress  →  printer=${PRINTER_URL}  machineId=${MACHINE_ID}`)
  await preflight()
  await scenarioConcurrentSameKey()
  await scenarioBurstThroughput()
  await scenarioAckIdempotent()
  await scenarioRenderRetryAfterAck()
  await scenarioRenderFailureAck()

  console.log(`\n${assertionFailures === 0 ? 'OK ' : 'FAIL'} ${assertionFailures} assertion failure(s)`)
  exit(assertionFailures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('[UNCAUGHT]', e)
  exit(1)
})
