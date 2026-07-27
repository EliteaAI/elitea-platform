/**
 * R-M2 / R-M4 decision logic (spec §6.5), proven by the F2 gate self-test.
 *
 *   R-M2 — an MSW handler may not answer with an inline object/array literal;
 *          bodies derive from Channel-B fixture files. (M1's
 *          scripts/check-handlers.mjs wires this into §6.6; the logic and its
 *          RED/GREEN fixtures live here so the rule is proven on this stack.)
 *   R-M4 — a fixture older than 30 days fails CI. (M1's
 *          scripts/check-fixture-freshness.mjs; same arrangement.)
 *
 * R-M3 / R-M5 are enforced at runtime by src/test/msw/register.ts and
 * src/test/setup.ts respectively.
 */
import { parse } from '@babel/parser';

import { walk } from './budgets-core.mjs';

const RESPONSE_FACTORIES = new Set(['json', 'text', 'xml', 'html']);
const RESPONSE_OBJECTS = new Set(['HttpResponse', 'Response']);
const LITERAL_BODY_TYPES = new Set(['ObjectExpression', 'ArrayExpression']);

/**
 * R-M2: scan a handler module's source for `HttpResponse.json({...literal})`
 * (and Response.json / .text with literals). Returns findings; empty == pass.
 */
export function checkHandlerSource(filename, source) {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: filename.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'],
  });
  const findings = [];
  walk(ast.program, (node) => {
    if (node.type !== 'CallExpression') return;
    const callee = node.callee;
    if (
      callee.type !== 'MemberExpression' ||
      callee.object.type !== 'Identifier' ||
      !RESPONSE_OBJECTS.has(callee.object.name) ||
      callee.property.type !== 'Identifier' ||
      !RESPONSE_FACTORIES.has(callee.property.name)
    ) {
      return;
    }
    const body = node.arguments[0];
    if (body && LITERAL_BODY_TYPES.has(body.type)) {
      findings.push({
        rule: 'R-M2',
        file: filename,
        line: node.loc.start.line,
        message: `${callee.object.name}.${callee.property.name}(<inline literal>) — handler bodies derive from Channel-B fixture files, never hand-written literals`,
      });
    }
  });
  return findings;
}

export const FIXTURE_MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * R-M4: a fixture must carry a parseable recordedAt no older than 30 days.
 * `fixture` is the parsed JSON document; `now` is injectable for tests.
 */
export function checkFixtureFreshness(filename, fixture, now = new Date()) {
  const recordedAt = fixture && fixture.recordedAt;
  if (typeof recordedAt !== 'string' || Number.isNaN(Date.parse(recordedAt))) {
    return [
      {
        rule: 'R-M4',
        file: filename,
        line: 1,
        message: 'fixture has no parseable recordedAt — re-record it from the real stack (scripts/record-fixtures.mjs)',
      },
    ];
  }
  const ageDays = (now.getTime() - Date.parse(recordedAt)) / DAY_MS;
  if (ageDays > FIXTURE_MAX_AGE_DAYS) {
    return [
      {
        rule: 'R-M4',
        file: filename,
        line: 1,
        message: `fixture recorded ${Math.floor(ageDays)} days ago (max ${FIXTURE_MAX_AGE_DAYS}) — stale fixtures describe a backend that no longer exists`,
      },
    ];
  }
  return [];
}
