/**
 * Asserts every route actually renders the page component it is supposed to.
 *
 * WHY THIS EXISTS, and why the existing coverage did not catch it:
 *
 * PR #82 shipped 38 routes rendering a `RouteShell` — a heading and nothing
 * else — while fully-built page components sat unimported. 62 E2E journeys
 * and a full unit suite were green throughout, because:
 *
 *  - `allRoutesSmoke.test.tsx` mounts every route and asserts it settles to
 *    `idle` without erroring. A route rendering an empty `<div>` passes that.
 *  - The E2E journeys asserted `data-testid` presence and URL changes, which
 *    a stub satisfies exactly as well as the real screen.
 *
 * Neither answers "is this route wired to the RIGHT thing", so this does.
 * It is deliberately STATIC — it reads the route sources rather than
 * mounting them. That makes it fast, deterministic, and free of the data
 * mocking 37 real pages would need; the tradeoff is that it proves the
 * wiring, not the behaviour, and that limit is stated rather than implied.
 *
 * The expectations are not hand-maintained here: they are driven by
 * `parity/route-wiring-map.json`, whose mechanical fields are re-derived
 * from `src/routes/**` by `scripts/build-route-wiring-map.mjs` and gated in
 * CI (`gate-route-wiring-map`). So this test and the map cannot drift apart
 * without one of the two failing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import wiringMap from '../../../parity/route-wiring-map.json';

interface WiringRow {
  readonly routeFile: string;
  readonly targetPath: string | null;
  readonly targetSpecifier: string | null;
  readonly targetExport: string | null;
  readonly bodyShape: string;
  readonly status: string;
  readonly requiredProps: readonly string[];
}

const rows = wiringMap.routes as readonly WiringRow[];
// Driven by what each route actually renders (`bodyShape`), not by the curated
// `status` field. `status` only covered the 38 hand-listed routes, so the other
// 38 — `/mcp-auth-callback` among them — were outside every assertion below.
const wired = rows.filter((row) => row.bodyShape === 'renders-page');

function readRoute(routeFile: string): string {
  return readFileSync(join(process.cwd(), routeFile), 'utf8');
}

describe('route wiring', () => {
  it('has a non-trivial set of wired routes to check (guards against an empty-map false pass)', () => {
    // If the map ever regressed to zero rows, every it.each below would
    // vacuously pass. 30 is a floor, not the exact count, so ordinary
    // additions do not churn this test.
    expect(wired.length).toBeGreaterThan(30);
  });

  it.each(wired.map((row) => [row.routeFile, row] as const))(
    '%s imports and renders its mapped page component',
    (_name, row) => {
      const source = readRoute(row.routeFile);
      const specifier = row.targetSpecifier;

      expect(specifier, `${row.routeFile} has no recorded target specifier`).not.toBeNull();
      expect(
        source.includes(`'${specifier}'`),
        `${row.routeFile} does not import ${specifier}`,
      ).toBe(true);

      // Two legitimate shapes, both accepted:
      //   `component: Artifacts,`        — handed straight to createFileRoute
      //                                    when the route needs no wrapper
      //   `<Applications />`             — rendered inside a wrapper that
      //                                    supplies props or outlet composition
      // A trailing boundary in both patterns stops `<Apps` being satisfied by
      // `<AppsSomethingElse`, or `component: Apps` by `component: AppsFoo`.
      const rendersTarget =
        new RegExp(`<${row.targetExport}[\\s/>]`).test(source) ||
        new RegExp(`component:\\s*${row.targetExport}\\s*,`).test(source);
      expect(
        rendersTarget,
        `${row.routeFile} neither renders <${row.targetExport}> nor sets component: ${row.targetExport}`,
      ).toBe(true);
    },
  );

  it.each(wired.filter((row) => row.requiredProps.some((p) => !p.includes('.'))).map((row) => [row.routeFile, row] as const))(
    '%s passes every non-injected prop the map records',
    (_name, row) => {
      const source = readRoute(row.routeFile);

      // Scope the search to the target's own JSX element, NOT the whole file.
      // A whole-file search is satisfied by the route's docstring — e.g.
      // `/mcps/:tab` opens with "-> `Toolkits isMCP`", so dropping the real
      // `isMCP` prop from the JSX still passed. Verified by mutation: that
      // exact deletion went undetected until this was narrowed.
      const element = new RegExp(`<${row.targetExport}\\b[^>]*/?>`, 's').exec(source)?.[0];
      expect(element, `${row.routeFile} has no <${row.targetExport}> element to inspect`).toBeDefined();

      // `deps.createToolkit`-style entries are injection points resolved
      // inside the page, not props the route spells out — filtered above.
      for (const prop of row.requiredProps.filter((p) => !p.includes('.'))) {
        expect(
          new RegExp(`\\b${prop}\\b`).test(element ?? ''),
          `${row.routeFile} does not pass required prop \`${prop}\` to <${row.targetExport}>`,
        ).toBe(true);
      }
    },
  );

  it('no route renders RouteShell — the component is deleted and must stay deleted', () => {
    // The stub component was removed once every route was wired. This is the
    // structural guarantee that a future change cannot quietly reintroduce
    // the #82 shape.
    const offenders = rows
      .map((row) => row.routeFile)
      .filter((file) => /<RouteShell[\s/>]/.test(readRoute(file)));
    expect(offenders).toEqual([]);
  });
});
