#!/usr/bin/env node
/**
 * record-fixtures.mjs — the Channel-B fixture recorder (spec §5.2/§6.5,
 * unit M1). Hits a REAL backend and writes `{recordedAt, body}` JSON files
 * to src/test/msw/fixtures/**, so R-M4 (`scripts/check-fixture-freshness.mjs`)
 * has something genuine to re-stamp against instead of drifting silently.
 *
 * ── This is a dev/CI-maintenance tool, NOT part of the test suite ─────────
 * Nothing in `npm run test:unit` or ci-web.yml invokes this script — the
 * gates (check-handlers/check-fixture-freshness) only read what's already
 * on disk. It is meant to be run BY A HUMAN, locally, against a real
 * `DEPLOYMENT_URL`, when a fixture needs re-recording (R-M4 staleness) or a
 * new hand-authored handler needs its first real Channel-B capture.
 *
 * Usage (env vars, per CLAUDE.md's C7/§7.1 convention):
 *   DEPLOYMENT_URL=https://dev.elitea.ai \
 *   API_KEY=<bearer-token> \
 *   PROJECT_ID=<project-id> \
 *   npm run record-fixtures                      # records every target
 *
 *   npm run record-fixtures -- --only artifacts.bucketList,transport.author
 *   npm run record-fixtures -- --list             # prints targets, records nothing
 *   npm run record-fixtures -- --bucket demo-bucket --key notes.md --application-id 42
 *
 * Fails LOUDLY and does nothing destructive when the real backend isn't
 * reachable: refuses before making any request if DEPLOYMENT_URL is unset
 * (exit 2 — a configuration error, distinct from a recording failure), and
 * for each individual target that 404s/times out/network-errors, prints the
 * failure and leaves that target's existing fixture file UNTOUCHED (a
 * failed recording never corrupts or blanks a working fixture) — the
 * process still exits non-zero so a human notices.
 *
 * ── Honest scope: which of the 18 fixtures under src/test/msw/fixtures/
 *    this tool can (and cannot) actually re-record ─────────────────────────
 * Every fixture currently checked in is `"synthetic": true` — none of the
 * 18 were ever a real Channel-B capture (see each fixture's own `note`
 * field). This script closes that gap for the subset that maps to a real,
 * single-GET backend route with a small, enumerable parameter set (the
 * TARGETS table below). The rest are synthetic BY DESIGN, not by omission,
 * and this tool deliberately does not touch them:
 *   - transport.{probe,echo,loginPage,notFound,unauthorized,forbidden}: the
 *     probed paths (`/__transport__/…`) exist on no real endpoint by
 *     construction (unit F4's own module doc) — recording them is
 *     impossible, not merely undone.
 *   - artifacts.s3Put: the real endpoint is a raw S3 PUT byte-proxy whose
 *     response body `putArtifactToS3` never inspects (unit S6's own
 *     comment) — a recording would add a real network dependency for zero
 *     behavioural gain.
 *   - upload.{chunkInProgress,chunkComplete,smallFile,error}: the real
 *     endpoint requires a genuine multipart/chunked file upload (binary
 *     body, chunk headers) POSTed to `/elitea_core/attachments/prompt_lib/…`
 *     — out of scope for this pass; a real gap, flagged here rather than
 *     faked with a GET-shaped recorder that couldn't actually hit that
 *     endpoint correctly. Left as follow-up work.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(SCRIPT_DIR, '..');
const FIXTURES_DIR = join(APP_DIR, 'src', 'test', 'msw', 'fixtures');

/**
 * Each target maps ONE hand-authored fixture file to a real, recordable GET
 * route. `path(params)` builds the request path from CLI-suppliable params
 * (a `default` is provided for every param so `--only <id>` alone works
 * against a reasonable demo shape); `parse` controls whether the response
 * body is captured as parsed JSON or raw text (mirrors the handler that
 * consumes it — e.g. artifacts.content/download.export are plain text).
 */
const TARGETS = [
  {
    id: 'transport.author',
    fixture: 'transport/author.200.json',
    params: {},
    path: () => '/api/v2/social/author/',
    parse: 'json',
  },
  {
    id: 'artifacts.bucketList',
    fixture: 'artifacts/bucket-list.200.json',
    params: {},
    path: () => '/artifacts/s3/',
    parse: 'json',
  },
  {
    id: 'artifacts.artifactList',
    fixture: 'artifacts/artifact-list.200.json',
    params: { bucket: 'demo-bucket' },
    path: (p) => `/artifacts/s3/${encodeURIComponent(p.bucket)}`,
    parse: 'json',
  },
  {
    id: 'artifacts.content',
    fixture: 'artifacts/artifact-content.200.json',
    params: { projectId: null, bucket: 'demo-bucket', key: 'notes.md' },
    path: (p) => `/api/v2/artifacts/artifact/default/${encodeURIComponent(p.projectId)}/${encodeURIComponent(p.bucket)}/${encodeURIComponent(p.key)}`,
    parse: 'text',
  },
  {
    id: 'download.export',
    fixture: 'download/export.200.json',
    params: { projectId: null, applicationId: null },
    path: (p) => `/api/v2/elitea_core/export_import/prompt_lib/${encodeURIComponent(p.projectId)}/${encodeURIComponent(p.applicationId)}?format=md`,
    parse: 'text',
  },
];

function parseArgs(argv) {
  const opts = { only: null, list: false, bucket: 'demo-bucket', key: 'notes.md', applicationId: null, projectId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') opts.only = argv[++i]?.split(',').map((s) => s.trim());
    else if (a === '--list') opts.list = true;
    else if (a === '--bucket') opts.bucket = argv[++i];
    else if (a === '--key') opts.key = argv[++i];
    else if (a === '--application-id') opts.applicationId = argv[++i];
    else if (a === '--project-id') opts.projectId = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('usage: record-fixtures.mjs [--only id[,id...]] [--list] [--bucket b] [--key k] [--application-id id] [--project-id id]');
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function resolveParams(target, opts) {
  const resolved = { ...target.params };
  if ('projectId' in resolved) resolved.projectId = opts.projectId ?? process.env.PROJECT_ID ?? null;
  if ('bucket' in resolved) resolved.bucket = opts.bucket;
  if ('key' in resolved) resolved.key = opts.key;
  if ('applicationId' in resolved) resolved.applicationId = opts.applicationId;
  const missing = Object.entries(resolved)
    .filter(([, v]) => v === null || v === undefined || v === '')
    .map(([k]) => k);
  return { resolved, missing };
}

async function recordOne(target, deploymentUrl, apiKey, opts) {
  const { resolved, missing } = resolveParams(target, opts);
  if (missing.length > 0) {
    return { id: target.id, ok: false, reason: `missing required param(s): ${missing.join(', ')} (pass --${missing[0].replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())} or set PROJECT_ID)` };
  }

  const path = target.path(resolved);
  const url = new URL(path, deploymentUrl).toString();
  const headers = new Headers();
  if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`);

  let response;
  try {
    response = await fetch(url, { headers });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { id: target.id, ok: false, reason: `network error hitting ${url}: ${message}` };
  }
  if (!response.ok) {
    return { id: target.id, ok: false, reason: `${response.status} ${response.statusText} from ${url}` };
  }

  const body = target.parse === 'json' ? await response.json() : await response.text();
  const fixturePath = join(FIXTURES_DIR, target.fixture);
  const existing = tryReadExisting(fixturePath);
  const doc = {
    recordedAt: new Date().toISOString(),
    synthetic: false,
    source: `record-fixtures.mjs GET ${url}`,
    note: existing?.note ?? `Recorded from ${deploymentUrl} by record-fixtures.mjs.`,
    body,
  };
  mkdirSync(dirname(fixturePath), { recursive: true });
  writeFileSync(fixturePath, JSON.stringify(doc, null, 2) + '\n');
  return { id: target.id, ok: true, fixturePath: target.fixture };
}

function tryReadExisting(fixturePath) {
  try {
    return JSON.parse(readFileSync(fixturePath, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.list) {
    console.log('record-fixtures targets:');
    for (const t of TARGETS) console.log(`  ${t.id.padEnd(24)} -> src/test/msw/fixtures/${t.fixture}`);
    console.log('\nOut of scope by design (see this script\'s header comment): transport.{probe,echo,loginPage,');
    console.log('notFound,unauthorized,forbidden}, artifacts.s3Put, upload.{chunkInProgress,chunkComplete,smallFile,error}.');
    return;
  }

  const deploymentUrl = process.env.DEPLOYMENT_URL;
  if (!deploymentUrl) {
    console.error('record-fixtures: DEPLOYMENT_URL is not set — refusing to attempt any network call.');
    console.error('  Set DEPLOYMENT_URL (and API_KEY, PROJECT_ID as needed) per CLAUDE.md\'s env-var convention, e.g.:');
    console.error('    DEPLOYMENT_URL=https://dev.elitea.ai API_KEY=... PROJECT_ID=... npm run record-fixtures');
    process.exit(2);
  }

  const apiKey = process.env.API_KEY;
  const targets = opts.only ? TARGETS.filter((t) => opts.only.includes(t.id)) : TARGETS;
  if (targets.length === 0) {
    console.error(`record-fixtures: --only matched no targets (known ids: ${TARGETS.map((t) => t.id).join(', ')})`);
    process.exit(2);
  }

  console.log(`record-fixtures: recording ${targets.length} target(s) from ${deploymentUrl}${apiKey ? ' (authenticated)' : ' (NO API_KEY set — unauthenticated request)'}`);

  const results = [];
  for (const target of targets) {
    // Sequential, not Promise.all: this is a slow, human-invoked maintenance
    // tool hitting a real shared backend, not a hot path — no reason to
    // hammer it with concurrent requests.
    results.push(await recordOne(target, deploymentUrl, apiKey, opts));
  }

  let failures = 0;
  for (const r of results) {
    if (r.ok) {
      console.log(`  OK    ${r.id} -> ${r.fixturePath}`);
    } else {
      failures++;
      console.error(`  FAIL  ${r.id} — ${r.reason}`);
    }
  }

  if (failures > 0) {
    console.error(`record-fixtures: ${failures}/${results.length} target(s) failed — existing fixture files for those targets were left untouched`);
    process.exit(1);
  }
  console.log(`record-fixtures: OK — ${results.length}/${results.length} fixture(s) re-recorded from the real backend`);
}

main().catch((err) => {
  console.error('record-fixtures: unexpected failure:', err);
  process.exit(1);
});
