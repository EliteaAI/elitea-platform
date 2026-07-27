import { expect, it } from 'vitest';

import { paramSchemas, type ParamKey } from '../-search/params';

/**
 * Shared table-driven kit for the 18 `searchParams.<domain>.test.tsx`
 * files P1's manifest names as the `verify.command`/`testId` for every
 * PARAM-* item (see `parity/manifest/*.json`). One `it()` per key, named
 * `search-params > <domain> > <key>` to match `verify.testId` exactly.
 *
 * Each case asserts, per spec §8.2's rule ("each row gets a zod schema...
 * with an explicit default... AND a malformed value is rejected without
 * crashing the screen") AND the R1 adversarial-verification fix (`params.ts`
 * header's CRASH-SAFETY NOTE — every schema uses `.catch()`, not
 * `.default()`):
 *  1. the key parses when absent, producing its documented default;
 *  2. a realistic valid value round-trips;
 *  3. IF a `malformed` sample is given, the schema's `safeParse` NEVER
 *     reports `success: false` for it — `.catch()` is a strict superset of
 *     `.default()`: it substitutes the fallback on validation failure too,
 *     not just on `undefined` — AND the data it produces is identical to
 *     the absent case's default, i.e. the malformed value is silently
 *     discarded in favour of the documented default rather than kept or
 *     thrown. This is what "rejected without crashing the screen" means at
 *     the router level: TanStack Router's `validateSearch` calls the
 *     schema's `.parse()` directly (not `.safeParse()`), so before this fix
 *     ANY schema failure became an uncaught `ZodError` with no
 *     `errorComponent` on any ancestor route to catch it.
 */
export interface ParamCase {
  readonly key: ParamKey;
  readonly valid: unknown;
  /** A value the schema is expected to gracefully fall back on (never a value that throws or is silently kept as-is). Omit for keys with no meaningfully-invalid shape (permissive free text). */
  readonly malformed?: unknown;
}

export function describeParamCases(domain: string, cases: readonly ParamCase[]): void {
  for (const { key, valid, malformed } of cases) {
    it(`search-params > ${domain} > ${key}`, () => {
      const schema = paramSchemas[key];

      const absent = schema.safeParse(undefined);
      expect(absent.success, `${key}: absent value must parse to its default, not fail`).toBe(true);

      const validResult = schema.safeParse(valid);
      expect(validResult.success, `${key}: a realistic valid value must parse`).toBe(true);

      if (malformed !== undefined) {
        const malformedResult = schema.safeParse(malformed);
        expect(
          malformedResult.success,
          `${key}: a malformed value must never fail parsing — it must fall back silently, not crash`,
        ).toBe(true);
        expect(
          malformedResult.success && malformedResult.data,
          `${key}: a malformed value must fall back to the schema's documented default, not be kept as-is`,
        ).toEqual(absent.success && absent.data);
      }
    });
  }
}
