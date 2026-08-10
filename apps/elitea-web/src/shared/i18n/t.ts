/**
 * shared/i18n's public `t()` — spec N3 / §3.6 / R-T3 / §9.3 unit S8.
 *
 * The two required parameters were inherited from unit S1's interim shim
 * (`src/shared/ui/lib/t.ts`, `t: TFunction = (_key, fallback) => fallback`),
 * which issue #45 migrated away and deleted; this is the app's only `t`.
 *
 * A key present in `en.json` WINS over `fallback`. That is the point, and
 * it is also the one trap: if the bundle value carries `{{placeholder}}`
 * interpolation, the call site must pass the matching `options` — writing
 * the fallback as a JS template literal instead renders the placeholder
 * literally. A key that is NOT in `en.json` is reported (see `./i18n.ts`)
 * and degrades to `fallback`.
 *
 * `options` is additive (optional, ignored by any 2-argument call site) —
 * it exists so a future call site can pass i18next interpolation variables
 * or a `{ count }` for pluralization without changing this function's
 * signature again. See the package README for the `_one`/`_other` bundle
 * convention that pairs with `count`.
 *
 * `fallback` stays required, on purpose:
 *  1. It IS the i18next `defaultValue` — the string actually rendered
 *     while `key` is not (yet) present in `en.json`, so the UI never shows
 *     a raw key like `"feature.save"` mid-extraction.
 *  2. It IS the seed value: the extraction discipline (N3) is "wrap the
 *     string you already have," not "invent a key and separately go write
 *     copy for it" — the fallback is the copy, right there at the call
 *     site, visible in review.
 */
import type { TOptions } from 'i18next';

import { i18n } from './i18n';

export type TFunction = (key: string, fallback: string, options?: TOptions) => string;

export const t: TFunction = (key, fallback, options) => i18n.t(key, { ...options, defaultValue: fallback });
