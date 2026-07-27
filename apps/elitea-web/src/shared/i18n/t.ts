/**
 * shared/i18n's public `t()` — spec N3 / §3.6 / R-T3 / §9.3 unit S8.
 *
 * The two required parameters match unit S1's interim shim exactly
 * (`src/shared/ui/lib/t.ts`, `TFunction = (key: string, fallback: string)
 * => string`, `t: TFunction = (_key, fallback) => fallback`), so this is a
 * behavioural superset, not a breaking change: every call written against
 * the stub keeps compiling and keeps rendering the same fallback text the
 * moment it resolves against this bundle instead — the only difference is
 * that a key present in `en.json` now wins over the fallback, and a key
 * that ISN'T yet in `en.json` is reported (see `./i18n.ts`) instead of
 * silently always winning.
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
