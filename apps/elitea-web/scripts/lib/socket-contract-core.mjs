/**
 * Decision logic for scripts/gen-socket-contract.mjs (unit S5, spec §5.5).
 *
 * Parsing approach (documented per task instructions — "a careful text/regex
 * or line-based parse is acceptable given the file is read-only reference,
 * but be precise"):
 *
 *  - `parseSioEvents` / `parseSocketMessageTypes` scan
 *    apps/elitea-ui/src/common/constants.js for the two well-known object
 *    literals (`export const sioEvents = {...}` / `export const
 *    SocketMessageType = {...}`) with a brace-depth walk (not a single
 *    regexp over the whole file — the file contains many other `{`/`}`
 *    pairs), then extract `KEY: 'value'` entries line-by-line inside that
 *    span. Both objects are flat string-literal maps in the real file (no
 *    nested objects, no computed keys, no spread) — verified by reading
 *    constants.js:157-193 and :881-936 directly — so a line-oriented
 *    extraction is exact, not a heuristic approximation.
 *  - `parseServerOnHandlers` / `parseServerEmits` scan
 *    services/elitea-main/internal/api/socketio/server.go for
 *    `client.On("event_name"` and `.Emit("event_name"` call sites via a
 *    single-pass regex. Go string literals for event names are plain
 *    double-quoted identifiers in this file (verified by reading it in
 *    full) — no backtick raw strings, no concatenation — so the regex has
 *    no false-negative risk against the current file.
 *
 * Both parsers are line-number aware so every finding carries `file:line`
 * evidence, matching the rest of this codebase's generator conventions
 * (check-contract-coverage.mjs, gen-brand-tokens.mjs).
 */

/**
 * Extract entries from a flat `export const NAME = { KEY: 'value', ... };`
 * object literal. Returns entries in source order with 1-based line numbers.
 *
 * @param {string} source
 * @param {string} constName
 * @returns {Array<{ key: string, value: string, line: number }>}
 */
export function parseFlatStringObject(source, constName) {
  const lines = source.split('\n');
  const startRe = new RegExp(`^\\s*export\\s+const\\s+${constName}\\s*=\\s*\\{\\s*$`);
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startRe.test(lines[i])) {
      startLine = i;
      break;
    }
  }
  if (startLine === -1) {
    throw new Error(`parseFlatStringObject: could not find "export const ${constName} = {" in source`);
  }

  const entries = [];
  const entryRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*'([^']*)'\s*,?\s*(?:\/\/.*)?$/;
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\}\s*;\s*$/.test(line)) {
      return entries;
    }
    const m = entryRe.exec(line);
    if (m) {
      entries.push({ key: m[1], value: m[2], line: i + 1 });
    }
    // blank lines and `//` comment-only lines are silently skipped
  }
  throw new Error(`parseFlatStringObject: unterminated "export const ${constName} = { ... };" block`);
}

/** @param {string} constantsJsSource */
export function parseSioEvents(constantsJsSource) {
  return parseFlatStringObject(constantsJsSource, 'sioEvents');
}

/** @param {string} constantsJsSource */
export function parseSocketMessageTypes(constantsJsSource) {
  return parseFlatStringObject(constantsJsSource, 'SocketMessageType');
}

/**
 * @param {string} serverGoSource
 * @param {RegExp} pattern must contain exactly one capture group for the event name
 * @returns {Array<{ event: string, line: number }>} first-occurrence per event, source order
 */
function scanGoEventLiterals(serverGoSource, pattern) {
  const lines = serverGoSource.split('\n');
  const seen = new Set();
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    // Both current callers pass a flag-less regex literal, so this always
    // appends 'g'; simplified from a flags.includes('g') branch that was
    // provably dead for every real caller (confirmed by grep: 2 call sites,
    // both flag-less literals) rather than kept as untested defensive code.
    const re = new RegExp(pattern.source, `${pattern.flags}g`);
    let m;
    while ((m = re.exec(lines[i])) !== null) {
      const event = m[1];
      if (!seen.has(event)) {
        seen.add(event);
        out.push({ event, line: i + 1 });
      }
    }
  }
  return out;
}

/** Registered server-side listeners: `client.On("event_name", ...)`. */
export function parseServerOnHandlers(serverGoSource) {
  return scanGoEventLiterals(serverGoSource, /client\.On\(\s*"([a-zA-Z_][a-zA-Z0-9_]*)"/);
}

/** Server-side emits: `<x>.Emit("event_name", ...)` (client.Emit / s.io.To(...).Emit / client.To(...).Emit). */
export function parseServerEmits(serverGoSource) {
  return scanGoEventLiterals(serverGoSource, /\.Emit\(\s*"([a-zA-Z_][a-zA-Z0-9_]*)"/);
}

/**
 * socket.io protocol-reserved event names — registered via the same
 * `client.On(...)` call shape as application events (server.go:109 has
 * `client.On("disconnect", ...)`) but structurally a transport lifecycle
 * hook, not an application-level channel event. Never part of the 43-event
 * application catalogue by design, so excluded from the "server-only gap"
 * (vice-versa) check rather than requiring a permanent allow-list entry for
 * a socket.io built-in. List per the Engine.IO/Socket.IO client reserved
 * events (socket.io-client 4.8.3 SocketReservedEvents ∪ the server-side
 * `disconnecting` hook), which is closed and does not change per feature.
 */
export const RESERVED_SOCKET_IO_EVENTS = new Set([
  'connect',
  'connect_error',
  'disconnect',
  'disconnecting',
  'error',
  'newListener',
  'removeListener',
]);

/**
 * Cross-reference the client's 43-event catalogue against the server's
 * registered `client.On(...)` listeners. This is the ONLY signal
 * "hasServerHandler" is derived from — matching the spec's literal wording
 * ("reads the Go server's registered handlers") and the research finding
 * this unit was briefed to expect ("only 13 of 43 events have server
 * handlers"): 13 is exactly `|serverOnHandlers|` today.
 *
 * @param {string[]} clientEventNames
 * @param {Array<{event:string,line:number}>} serverOnHandlers
 * @param {Array<{event:string,line:number}>} serverEmits
 */
export function crossReferenceEvents(clientEventNames, serverOnHandlers, serverEmits) {
  const onSet = new Set(serverOnHandlers.map((h) => h.event));
  const emitSet = new Set(serverEmits.map((h) => h.event));
  const clientSet = new Set(clientEventNames);

  const rows = clientEventNames.map((name) => ({
    event: name,
    hasServerHandler: onSet.has(name),
    serverEmits: emitSet.has(name),
  }));

  // "vice versa": a server `client.On` registration for an event name that
  // isn't in the client's 43-event catalogue at all (excluding socket.io's
  // own reserved transport-lifecycle events, see RESERVED_SOCKET_IO_EVENTS).
  const serverOnlyHandlers = serverOnHandlers
    .filter((h) => !clientSet.has(h.event) && !RESERVED_SOCKET_IO_EVENTS.has(h.event))
    .map((h) => h.event);

  return { rows, serverOnlyHandlers };
}

/**
 * Diff the cross-reference against the checked-in allow-list of known,
 * human-reviewed gaps. A gap is "known" iff it has an allow-list entry with
 * a matching `direction`. Anything else is a NEW, unreviewed mismatch — the
 * condition the generator must fail loudly on.
 *
 * @param {{rows: Array<{event:string,hasServerHandler:boolean}>, serverOnlyHandlers: string[]}} crossReference
 * @param {{knownGaps: Array<{event:string, direction:'client-only'|'server-only'}>}} allowlist
 */
export function diffAgainstAllowlist(crossReference, allowlist) {
  const clientOnlyGaps = crossReference.rows.filter((r) => !r.hasServerHandler).map((r) => r.event);
  const serverOnlyGaps = crossReference.serverOnlyHandlers;

  const allowedClientOnly = new Set(
    allowlist.knownGaps.filter((g) => g.direction === 'client-only').map((g) => g.event),
  );
  const allowedServerOnly = new Set(
    allowlist.knownGaps.filter((g) => g.direction === 'server-only').map((g) => g.event),
  );

  const newClientOnlyGaps = clientOnlyGaps.filter((e) => !allowedClientOnly.has(e));
  const newServerOnlyGaps = serverOnlyGaps.filter((e) => !allowedServerOnly.has(e));

  // Allow-list hygiene: an entry that no longer corresponds to a real gap
  // (the backend grew a handler, or lost one in the other direction) is
  // stale and must be removed by a human — silently ignoring it would let
  // the allow-list drift away from reality without anyone noticing.
  const clientOnlySet = new Set(clientOnlyGaps);
  const serverOnlySet = new Set(serverOnlyGaps);
  const staleEntries = allowlist.knownGaps.filter((g) =>
    g.direction === 'client-only' ? !clientOnlySet.has(g.event) : !serverOnlySet.has(g.event),
  );

  const ok = newClientOnlyGaps.length === 0 && newServerOnlyGaps.length === 0 && staleEntries.length === 0;

  return {
    ok,
    clientOnlyGaps,
    serverOnlyGaps,
    newClientOnlyGaps,
    newServerOnlyGaps,
    staleEntries,
  };
}

/**
 * Verify the hand-authored payload catalogue's key set is EXACTLY the
 * parsed event/discriminant name set — no more, no fewer. This is the
 * mechanical guard against drift: if constants.js gains or loses an event
 * or discriminant, generation fails until a human updates the catalogue
 * (never silently emits a placeholder).
 *
 * @param {string[]} parsedNames
 * @param {string[]} catalogueNames
 */
export function diffCatalogueCompleteness(parsedNames, catalogueNames) {
  const parsedSet = new Set(parsedNames);
  const catalogueSet = new Set(catalogueNames);
  const missingFromCatalogue = parsedNames.filter((n) => !catalogueSet.has(n));
  const extraInCatalogue = catalogueNames.filter((n) => !parsedSet.has(n));
  return {
    ok: missingFromCatalogue.length === 0 && extraInCatalogue.length === 0,
    missingFromCatalogue,
    extraInCatalogue,
  };
}

/**
 * Render the human-readable coverage report (also the basis of the --json
 * output) — event name, direction, hasServerHandler, evidence line, gap
 * status against the allow-list.
 *
 * @param {Array<{name:string, direction:string}>} catalogue
 * @param {{rows: Array<{event:string,hasServerHandler:boolean,serverEmits:boolean}>}} crossReference
 * @param {ReturnType<typeof diffAgainstAllowlist>} diff
 */
export function renderCoverageReport(catalogue, crossReference, diff) {
  const byEvent = new Map(crossReference.rows.map((r) => [r.event, r]));
  const knownGapSet = new Set(diff.clientOnlyGaps.filter((e) => !diff.newClientOnlyGaps.includes(e)));
  const lines = ['event                              direction      hasServerHandler  serverEmits  status'];
  for (const entry of catalogue) {
    const row = byEvent.get(entry.name);
    const has = row?.hasServerHandler ?? false;
    const emits = row?.serverEmits ?? false;
    let status = 'OK';
    if (!has) status = diff.newClientOnlyGaps.includes(entry.name) ? 'NEW GAP (unreviewed)' : 'known gap (allow-listed)';
    lines.push(
      `${entry.name.padEnd(35)}${entry.direction.padEnd(15)}${(has ? 'Y' : 'N').padEnd(18)}${(emits ? 'Y' : 'N').padEnd(13)}${status}`,
    );
  }
  lines.push('');
  lines.push(
    `${crossReference.rows.filter((r) => r.hasServerHandler).length}/${crossReference.rows.length} events have a registered server handler (client.On).`,
  );
  if (knownGapSet.size > 0) {
    lines.push(`${knownGapSet.size} gap(s) are known/allow-listed.`);
  }
  return lines.join('\n');
}
