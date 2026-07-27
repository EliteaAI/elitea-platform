/**
 * Interim `t()` shim (spec §3.6 / R-T3, N3).
 *
 * Unit S8 owns the real `i18next`/`react-i18next` wiring; it has not landed
 * yet. R-T3's lint rule (`i18next/no-literal-string`, `.oxlintrc.json`) is
 * already live, so every user-visible string in `shared/ui` must already
 * flow through a `t()` call or the gate fails on this unit's own PR — the
 * point of authoring the extraction discipline now (N3) is that swapping
 * this file's body for a real `useTranslation()`-backed call is later a
 * one-file change, not a second rewrite.
 *
 * Contract: `t(key, fallback)` always returns `fallback` today. `key` is
 * still required and typed so call sites are already shaped the way the
 * real bundle will need them (a stable `namespace.component.field`-style
 * key), and so a future codemod can extract `(key, fallback)` pairs
 * mechanically into `en` bundle entries.
 *
 * Do not import `i18next`/`react-i18next` here — that is S8's landing, not
 * a dependency this shim should pre-empt.
 */
export type TFunction = (key: string, fallback: string) => string;

export const t: TFunction = (_key, fallback) => fallback;
