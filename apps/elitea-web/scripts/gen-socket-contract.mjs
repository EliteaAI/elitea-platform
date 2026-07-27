#!/usr/bin/env node
/**
 * spec §5.5 — the socket contract generator (unit S5). Reads the Go
 * server's registered handlers and the old app's event/discriminant
 * catalogues, cross-references them, and emits:
 *   - src/shared/api/socket/events.ts    (43 events + payload types)
 *   - src/shared/api/socket/messages.ts  (34 SocketMessageType discriminants)
 *
 * FAILS (non-zero exit) when:
 *   - a client-catalogued event has no registered server `client.On(...)`
 *     handler AND is not listed in scripts/socket-contract.allowlist.json
 *     (a NEW, unreviewed gap);
 *   - the allow-list contains a stale entry that no longer corresponds to a
 *     real gap (hygiene — the allow-list must track reality, not accumulate);
 *   - a server `client.On(...)` registration exists for an event name
 *     absent from the client's 43-event catalogue and isn't allow-listed
 *     (the "vice-versa" direction);
 *   - the hand-authored payload catalogue (scripts/lib/socket-contract-render.mjs)
 *     doesn't have an entry for every parsed event/discriminant, or has an
 *     entry for one that no longer exists (drift guard).
 *
 * A KNOWN gap (present in the allow-list) does not fail the build — the
 * generator still emits events.ts/messages.ts with hasServerHandler: false
 * for it, and the coverage report calls it out as "known gap".
 *
 * Usage:
 *   node scripts/gen-socket-contract.mjs \
 *     [--constants <path/to/constants.js>] \
 *     [--server-go <path/to/server.go>] \
 *     [--allowlist <path/to/allowlist.json>] \
 *     [--json] [--check]
 *
 * Defaults resolve relative to the repo root two levels above apps/elitea-web
 * (apps/elitea-ui/src/common/constants.js, services/elitea-main/internal/api/socketio/server.go).
 * In a worktree where the apps/elitea-ui submodule isn't checked out, pass
 * --constants explicitly (documented in the S5 final report).
 *
 * --check: verify the on-disk events.ts/messages.ts match what generation
 * would produce, without writing (CI drift check); exits 1 on mismatch.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  crossReferenceEvents,
  diffAgainstAllowlist,
  diffCatalogueCompleteness,
  parseServerEmits,
  parseServerOnHandlers,
  parseSioEvents,
  parseSocketMessageTypes,
  renderCoverageReport,
} from './lib/socket-contract-core.mjs';
import { DISCRIMINANT_CATALOGUE, EVENT_CATALOGUE, renderEventsTs, renderMessagesTs } from './lib/socket-contract-render.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(appDir, '..', '..');

function parseArgs(argv) {
  const opts = {
    constants: path.join(repoRoot, 'apps/elitea-ui/src/common/constants.js'),
    serverGo: path.join(repoRoot, 'services/elitea-main/internal/api/socketio/server.go'),
    allowlist: path.join(scriptDir, 'socket-contract.allowlist.json'),
    json: false,
    check: false,
  };
  const VALUE_FLAGS = { '--constants': 'constants', '--server-go': 'serverGo', '--allowlist': 'allowlist' };
  const FLAGS = { '--json': 'json', '--check': 'check' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS[a]) {
      opts[VALUE_FLAGS[a]] = path.resolve(argv[++i]);
    } else if (FLAGS[a]) {
      opts[FLAGS[a]] = true;
    } else if (a === '--help' || a === '-h') {
      console.log('usage: gen-socket-contract.mjs [--constants path] [--server-go path] [--allowlist path] [--json] [--check]');
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function readSource(filePath, hint) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`gen-socket-contract: cannot read ${filePath} (${err.code ?? err.message})`);
    if (hint) console.error(hint);
    process.exit(2);
  }
  return undefined; // unreachable — process.exit above never returns; keeps the function's static type honest
}

function readAllowlist(allowlistPath) {
  const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));
  if (!Array.isArray(allowlist.knownGaps)) {
    console.error(`gen-socket-contract: ${allowlistPath} has no "knownGaps" array`);
    process.exit(2);
  }
  return allowlist;
}

/** Drift guard: fails loudly if the hand-authored catalogue and the parsed source disagree on the name set. Returns nothing; exits the process on failure. */
function checkCompleteness(label, sourceModule, parsedNames, catalogueNames) {
  const result = diffCatalogueCompleteness(parsedNames, catalogueNames);
  if (result.ok) return;
  console.error(`gen-socket-contract: FAIL — ${label} catalogue (${sourceModule}) is out of sync with its constants.js source`);
  if (result.missingFromCatalogue.length > 0) {
    console.error(`  missing from catalogue (present in constants.js): ${result.missingFromCatalogue.join(', ')}`);
  }
  if (result.extraInCatalogue.length > 0) {
    console.error(`  extra in catalogue (absent from constants.js): ${result.extraInCatalogue.join(', ')}`);
  }
  process.exit(1);
}

function printReport(opts, clientEventNames, discriminantEntries, crossReference, diff) {
  if (!opts.json) {
    console.log(renderCoverageReport(EVENT_CATALOGUE, crossReference, diff));
    return;
  }
  console.log(
    JSON.stringify(
      {
        totalEvents: clientEventNames.length,
        totalDiscriminants: discriminantEntries.length,
        serverHandlerCount: crossReference.rows.filter((r) => r.hasServerHandler).length,
        rows: crossReference.rows,
        diff,
      },
      null,
      2,
    ),
  );
}

/** Exits the process with a FAIL message when diff.ok is false; otherwise returns. */
function enforceAllowlist(diff) {
  if (diff.ok) return;
  console.error('');
  console.error("gen-socket-contract: FAIL — unreviewed gap(s) between the client event catalogue and the server's registered handlers.");
  if (diff.newClientOnlyGaps.length > 0) {
    console.error(`  NEW client-only gap(s) (no server client.On handler, not allow-listed): ${diff.newClientOnlyGaps.join(', ')}`);
    console.error('  -> add a human-reviewed entry to scripts/socket-contract.allowlist.json if this is expected, or wire up the server handler.');
  }
  if (diff.newServerOnlyGaps.length > 0) {
    console.error(`  NEW server-only gap(s) (client.On handler for an event absent from the 43-event catalogue): ${diff.newServerOnlyGaps.join(', ')}`);
  }
  if (diff.staleEntries.length > 0) {
    console.error(`  STALE allow-list entries (no longer a real gap — remove them): ${diff.staleEntries.map((e) => e.event).join(', ')}`);
  }
  process.exit(1);
}

/** --check mode: verify on-disk output matches freshly-generated content, without writing. Exits the process either way. */
function runCheckMode(outDir, eventsTs, messagesTs) {
  let current;
  try {
    current = {
      events: readFileSync(path.join(outDir, 'events.ts'), 'utf8'),
      messages: readFileSync(path.join(outDir, 'messages.ts'), 'utf8'),
    };
  } catch {
    console.error('gen-socket-contract: --check FAIL — events.ts/messages.ts do not exist yet; run without --check first.');
    process.exit(1);
  }
  const eventsMatch = current.events === eventsTs;
  const messagesMatch = current.messages === messagesTs;
  if (!eventsMatch || !messagesMatch) {
    console.error('gen-socket-contract: --check FAIL — on-disk output is stale; re-run without --check to regenerate.');
    if (!eventsMatch) console.error('  events.ts differs from generated output');
    if (!messagesMatch) console.error('  messages.ts differs from generated output');
    process.exit(1);
  }
  console.log('gen-socket-contract: --check OK — events.ts and messages.ts are up to date.');
  process.exit(0);
}

function writeOutput(outDir, eventsTs, messagesTs, clientEventCount, discriminantCount) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'events.ts'), eventsTs, 'utf8');
  writeFileSync(path.join(outDir, 'messages.ts'), messagesTs, 'utf8');
  console.log('');
  console.log(
    `gen-socket-contract: OK — wrote ${path.relative(repoRoot, path.join(outDir, 'events.ts'))} (${clientEventCount} events) and ${path.relative(repoRoot, path.join(outDir, 'messages.ts'))} (${discriminantCount} discriminants).`,
  );
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const constantsSource = readSource(
    opts.constants,
    '  hint: apps/elitea-ui is a git submodule; in a worktree where it is not checked out,\n  pass --constants pointing at a checkout that has it (e.g. the main checkout).',
  );
  const serverGoSource = readSource(opts.serverGo);
  const allowlist = readAllowlist(opts.allowlist);

  const sioEventEntries = parseSioEvents(constantsSource);
  const discriminantEntries = parseSocketMessageTypes(constantsSource);
  const serverOnHandlers = parseServerOnHandlers(serverGoSource);
  const serverEmits = parseServerEmits(serverGoSource);
  const clientEventNames = sioEventEntries.map((e) => e.value);

  checkCompleteness('event', 'scripts/lib/socket-contract-render.mjs', clientEventNames, EVENT_CATALOGUE.map((e) => e.name));
  checkCompleteness(
    'discriminant',
    'scripts/lib/socket-contract-render.mjs',
    discriminantEntries.map((e) => e.value),
    DISCRIMINANT_CATALOGUE.map((e) => e.value),
  );

  const crossReference = crossReferenceEvents(clientEventNames, serverOnHandlers, serverEmits);
  const diff = diffAgainstAllowlist(crossReference, allowlist);

  printReport(opts, clientEventNames, discriminantEntries, crossReference, diff);
  enforceAllowlist(diff);

  const outDir = path.join(appDir, 'src/shared/api/socket');
  const eventsTs = renderEventsTs(crossReference.rows);
  const messagesTs = renderMessagesTs();

  if (opts.check) {
    runCheckMode(outDir, eventsTs, messagesTs);
    return;
  }

  writeOutput(outDir, eventsTs, messagesTs, clientEventNames.length, discriminantEntries.length);
}

main();
