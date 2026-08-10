# `shared/i18n` — the extraction shim (spec N3, §3.6/R-T3, §2.5, §9.3 unit S8)

There is no i18n **today** — one bundle, one locale (`en`), no language
switcher, no backend. What's real starting now is the **extraction
discipline**: every user-visible string in JSX goes through `t()`, so
shipping a second locale later is a config change (a new `resources` entry
in `i18n.ts` + a language selector somewhere in the app), not a second
rewrite of 950 component files.

## Public API

```ts
import { t, I18nProvider, i18n } from '@/shared/i18n';
```

| Export | What it is | Who uses it |
|---|---|---|
| `t(key, fallback, options?)` | The only sanctioned way to put copy in JSX. | Every `features/`/`widgets/`/`pages/`/`shared/ui` component. |
| `I18nProvider` | `react-i18next`'s real `I18nextProvider`, pre-bound to the configured instance. | `app/` composition root (R2) only. |
| `i18n` | The raw configured `i18next` instance. | Tests, and any future language switcher. Not for calling `.t()` directly — use `t()`. |

## Adding a new key

At the call site, write the key and the English copy together — the
fallback **is** the copy, not a placeholder:

```tsx
// Before (fails R-T3's lint gate — bare string in JSX text position):
<Button>Save changes</Button>

// After:
<Button>{t('settings.profile.saveButton', 'Save changes')}</Button>
```

Then add the same pair to `en.json`, keyed identically:

```json
{
  "settings.profile.saveButton": "Save changes"
}
```

**Key style:** flat, dot-delimited, `feature.component.field` (matches the
shape unit S1's interim shim already documents). Flat keys, not nested JSON
objects — a nested `{ "settings": { "profile": { "saveButton": "…" } } }`
shape works with i18next too, but flat keys are what unit S8's own
extraction grep (`grep -rnE "\bt\(['\"]" src`) can line up 1:1 against
`en.json` entries without a JSON-tree walk, which is what keeps this file
auditable as it grows past a handful of keys.

`label`/`title`/`placeholder`/`aria-label`/`alt` props need `t()` too —
R-T3's lint rule checks those attributes, not just JSX text children.

## The fallback is not optional, and it is not decoration

`t(key, fallback)`'s `fallback` becomes i18next's `defaultValue` for that
call. Two consequences:

1. **The UI never shows a raw key.** If `key` is not yet in `en.json` (a
   key was just added at a call site but the bundle entry hasn't landed
   yet, or never will because of a typo), the rendered text is `fallback`,
   not `"settings.profile.saveButton"`.
2. **A missing key is reported, in every environment**, via
   `missingKeyHandler` in `i18n.ts` (`console.warn`). This is deliberately
   **not** gated behind `import.meta.env.DEV`: `en.json` is expected to be
   complete for every key that ships (that's what this seeding step and
   R-T3's lint gate together guarantee), so a missing-key warning anywhere
   is a real defect signal — a key that was renamed on one side and not the
   other, a typo, or a key that was extracted but never added to the
   bundle — not routine noise to suppress. It still renders `fallback`,
   never blocking the page.

## Pluralization

Not needed by anything landed yet (no ported component calls `t()` with a
`%s`/count-style string as of this unit's landing — see "Current bundle
state" below). When one does, use i18next's built-in `_one`/`_other`
suffix convention rather than hand-rolled `count === 1 ? … : …` branches:

```json
{
  "results.count_one": "{{count}} result",
  "results.count_other": "{{count}} results"
}
```

```tsx
{t('results.count', '{{count}} results', { count: results.length })}
```

`options.count` is what selects `_one` vs `_other` (English has two plural
forms; i18next's plural resolver handles languages with more, e.g. Russian's
`_one`/`_few`/`_many`, automatically once a second locale exists).
Interpolation (`{{count}}`, `{{name}}`, …) is applied to the `fallback`
string too, not just to a matched bundle entry, via i18next's
`defaultValue` interpolation — so the fallback renders correctly even
before the bundle entry exists.

## Current bundle state

`en.json` holds 1,634 flat, dotted keys and is kept in sync mechanically.

- **One `t` source.** Every call site imports `t` from `@/shared/i18n`. The
  pre-S8 interim stub `src/shared/ui/lib/t.ts` (`t = (_key, fallback) =>
  fallback`) was deleted by issue #45, which migrated its last 79 importers.
  There is no longer a second, always-fallback `t()` in the app.
- **The gate.** `node scripts/i18n-backfill.mjs --check` (ci-web.yml's
  `gate-i18n-sync` job) fails if any call site's key is absent from
  `en.json`, if call sites disagree on a key's fallback, or if a shipped
  value has drifted from its call site. Run `node scripts/i18n-backfill.mjs`
  (no flag) to add the safe entries; conflicts are reported, never
  auto-resolved.
- **Interpolation.** A key whose `en.json` value contains `{{placeholder}}`
  MUST be called with a matching options object — `t('k', 'Every {{n}}
  minutes', { n: step })`. Writing the fallback as a JS template literal
  (`` `Every ${step} minutes` ``) instead is a trap: it reads correctly, but
  the bundle value wins at runtime and the placeholder renders literally.
  The gate flags any non-static fallback as `interpolated-fallback` for
  exactly this reason.

The next unit that adds a `t()` call site is also responsible for adding the
matching entry to `en.json`; `missingKeyHandler` above catches it at runtime
if the gate is somehow bypassed.

## Design notes for the next reader

- **Why a flat `en.json`, not a `locales/en/*.json` split:** one namespace
  (`translation`, i18next's default), one file, because there is exactly
  one bundle. A `locales/en/<namespace>.json` split only pays for itself
  once there are enough keys to want namespace-scoped loading or
  code-splitting; today (0 landed keys) that's premature structure. `t()`
  and `I18nProvider` are the only exports call sites and the composition
  root touch, so migrating to a namespaced split later is a change
  contained entirely to `i18n.ts` + `en.json`'s replacement — no call-site
  churn.
- **Why `t()` is a plain function, not a `useT()` hook:** it matches unit
  S1's already-published call signature (`(key, fallback) => string`)
  exactly, so no call site needs to change when it starts resolving against
  this bundle instead of the always-fallback stub. The tradeoff: `t()`
  reads the singleton instance directly, so a component using it does not
  re-render on `i18n.changeLanguage(...)`. That's a non-issue today (one
  locale, no switcher); if/when a second locale ships, either add a
  `useT()` hook alongside `t()` for components that need live reactivity,
  or key the app's root on `i18n.language` to force a full re-render on
  change — that decision belongs to whichever unit ships the switcher, not
  this one.
- **Why `saveMissing: true` + a custom `missingKeyHandler` instead of just
  `debug: true`:** `debug: true` logs *every* lookup, matched or not, which
  buries the one signal that matters (an unresolved key) in noise from
  every resolved one. `missingKeyHandler` fires only on the miss.
