// overhead_loadtest.js — k6 load test for gateway-hop overhead measurement
//
// Gate: BFF.9d (overhead-check subcommand).
// Spec: §2.4 — the gateway forwarding hop must not add more than 50 ms p99 to
// the round-trip measured at the caller.
//
// Usage (against a staging gateway):
//
//   k6 run \
//     --summary-export summary.json \
//     -e GATEWAY_URL=http://gateway.staging.elitea.internal:8083 \
//     -e API_KEY=<staging-api-key> \
//     -e PROJECT_ID=<staging-project-id> \
//     testdata/overhead_loadtest.js
//
// Then feed the export to the gate:
//
//   cutover-ctl overhead-check \
//     --summary summary.json \
//     --max-p99-overhead-ms 50
//
// What this script measures:
//   - It sends non-streaming POST /llm/v1/chat/completions requests with a
//     trivial prompt to minimise model-side latency variance.
//   - After each successful response it reads the gateway's X-Elapsed-Ms
//     response header (the gateway's own wall-clock time for the hop, set by the
//     gateway middleware in internal/middleware/timing.go).
//   - Each X-Elapsed-Ms value is recorded into the custom Trend metric
//     "gateway_overhead_ms". The overhead-check gate reads exactly this metric's
//     p(99) from the exported summary.
//   - If X-Elapsed-Ms is absent (e.g. the reverse proxy strips it), the script
//     falls back to recording the full http_req_duration so the gate can still
//     use its fallback metric.
//
// Load profile: 60 seconds total — 10 s ramp-up to 50 VUs, 40 s steady state,
// 10 s ramp-down. Typical staging run produces ~3 000 iterations.
//
// Thresholds embedded in the script give k6 a local pass/fail signal; the gate
// provides the canonical CI assertion from the exported summary file.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import exec from 'k6/execution';

// gatewayOverheadMs records the gateway-internal hop latency (milliseconds)
// from the X-Elapsed-Ms response header. This is the metric the overhead-check
// gate primarily reads.
const gatewayOverheadMs = new Trend('gateway_overhead_ms', true);

// ── Configuration ────────────────────────────────────────────────────────────
const GATEWAY_URL = __ENV.GATEWAY_URL || 'http://localhost:8083';
const API_KEY     = __ENV.API_KEY     || 'test-api-key';
const PROJECT_ID  = __ENV.PROJECT_ID  || 'test-project';
const MODEL       = __ENV.MODEL       || 'gpt-4o-mini';

// Request body: non-streaming, minimal prompt to keep upstream latency low.
const REQUEST_BODY = JSON.stringify({
  model: MODEL,
  stream: false,
  max_tokens: 8,
  messages: [{ role: 'user', content: 'Reply with one word: OK' }],
});

const HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${API_KEY}`,
  'X-Project-ID': PROJECT_ID,
};

// Signed edge-identity headers (required whenever the gateway runs with
// GATEWAY_IDENTITY_SECRET set — FIX #9 makes that mandatory with NATS on).
// The overhead-check subcommand pre-signs the tuple(s) and passes them via -e;
// the secret itself never reaches this script.
//
// IDENTITIES (JSON array of {project,user,tenant,signature}) spreads the load
// across many (project, model) tuples. This is REQUIRED against a production
// gateway: the §2.6 circular-routing breaker opens a tuple's circuit at
// >=5 req/1s, so a single-identity 50-VU run measures 429s, not overhead.
// Each VU keeps ONE identity (vu id modulo the set) and paces itself below
// the breaker threshold (see sleep() in the scenario).
const IDENTITIES = (() => {
  if (__ENV.IDENTITIES) {
    try { return JSON.parse(__ENV.IDENTITIES); } catch (e) { return []; }
  }
  if (__ENV.IDENTITY_PROJECT) {
    return [{
      project: __ENV.IDENTITY_PROJECT,
      user: __ENV.IDENTITY_USER || '',
      tenant: __ENV.IDENTITY_TENANT || '',
      signature: __ENV.IDENTITY_SIGNATURE || '',
    }];
  }
  return [];
})();

function identityHeaders() {
  if (IDENTITIES.length === 0) return {};
  const id = IDENTITIES[(exec.vu.idInTest - 1) % IDENTITIES.length];
  const h = {
    'X-Elitea-Project-Id': id.project,
    'X-Elitea-User-Id': id.user,
    'X-Elitea-Tenant-Id': id.tenant,
  };
  if (id.signature) h['X-Elitea-Identity-Signature'] = id.signature;
  return h;
}

// ── Load profile ─────────────────────────────────────────────────────────────
export const options = {
  stages: [
    { duration: '10s', target: 50 },  // ramp-up
    { duration: '40s', target: 50 },  // steady state
    { duration: '10s', target: 0  },  // ramp-down
  ],
  // Local thresholds for k6's own pass/fail output. The canonical CI assertion
  // is the overhead-check gate reading the exported summary; these provide an
  // early local signal.
  thresholds: {
    // Custom metric: p99 hop overhead under 50 ms.
    gateway_overhead_ms: ['p(99)<50'],
    // Sanity: overall round-trip p99 under 2 s (model latency included).
    http_req_duration: ['p(99)<2000'],
    // Error rate must stay below 1%.
    http_req_failed: ['rate<0.01'],
  },
};

// ── Virtual user scenario ─────────────────────────────────────────────────────
export default function () {
  const res = http.post(
    `${GATEWAY_URL}/llm/v1/chat/completions`,
    REQUEST_BODY,
    { headers: Object.assign({}, HEADERS, identityHeaders()), timeout: '10s' },
  );

  // Basic response checks.
  check(res, {
    'status is 200': (r) => r.status === 200,
    'body is JSON': (r) => {
      try { JSON.parse(r.body); return true; } catch { return false; }
    },
  });

  // Record gateway-hop overhead from the X-Elapsed-Ms header.
  // The gateway sets this header to its internal elapsed time in milliseconds
  // (float, e.g. "12.34"). If absent (stripped by a proxy), fall back to the
  // full round-trip duration so the test still records a conservative bound.
  const elapsedHeader = res.headers['X-Elapsed-Ms'] || res.headers['x-elapsed-ms'];
  if (elapsedHeader !== undefined) {
    const ms = parseFloat(elapsedHeader);
    if (!isNaN(ms)) {
      gatewayOverheadMs.add(ms);
    }
  } else {
    // Fallback: use the k6-measured round-trip duration as a conservative proxy.
    // This will be larger than the true hop overhead (it includes network RTT to
    // the test runner), so operators should investigate X-Elapsed-Ms propagation
    // if this path fires consistently.
    gatewayOverheadMs.add(res.timings.duration);
  }

  // Pace each VU below the §2.6 loop-breaker threshold for its own
  // (project, model) tuple (>=5 req/1s opens the circuit): 0.3 s floor keeps a
  // VU at ~<3.5 req/s even when the model answers instantly.
  sleep(0.3);
}

// ── Setup / teardown (optional) ───────────────────────────────────────────────
export function setup() {
  // Verify the gateway is reachable before the test starts.
  const health = http.get(`${GATEWAY_URL}/healthz`, { timeout: '5s' });
  if (health.status !== 200) {
    throw new Error(
      `Gateway health check failed (status ${health.status}). ` +
      `Is GATEWAY_URL=${GATEWAY_URL} correct?`
    );
  }
  console.log(`Gateway healthy at ${GATEWAY_URL}. Starting overhead load test.`);
}
