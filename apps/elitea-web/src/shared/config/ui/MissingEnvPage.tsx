/* oxlint-disable i18next/no-literal-string --
   TEMPORARY: user-visible copy is hard-coded because unit S8 (the i18n shim)
   has not landed. REMOVER: S8 — when src/shared/i18n lands its t() shim,
   route these strings through t() and delete this file-scoped exemption
   (same documented-temporary-exemption class F2 established for the F1
   scaffold entrypoints in .oxlintrc.json). */
import type { RequiredConfigKey } from '../schema';

/**
 * Behavioural parity with apps/elitea-ui/src/pages/EnvMissingPage.jsx: an
 * "[Error]" marker, the " System env missing: " sentence, and a list of the
 * missing variables under their old UPPER_CASE env names (the old page
 * rendered MISSING_ENVS, which held 'VITE_SERVER_URL'-style keys).
 *
 * Copy is byte-exact with the baseline, including the leading AND trailing
 * space inside `<p> System env missing: </p>` (EnvMissingPage.jsx:17):
 * parity item COPY-468 requires the old strings verbatim, and JSX preserves
 * both spaces because the text sits on a single line.
 *
 * Two deliberate deviations from the baseline:
 *  - the old page's hard-coded red/px inline styles are dropped — they are
 *    exactly what the §4.6 theme gate bans; T1's brand tokens restyle this
 *    page later.
 *  - `role="alert"` on the "[Error]" marker is an ADDITION, not parity: the
 *    old page announced nothing to assistive tech. It is an a11y improvement
 *    (R-C1 spirit) but it is a real change to the accessibility tree, so it
 *    is recorded here as a deliberate, waiver-worthy deviation (§8.4) rather
 *    than smuggled in silently.
 */
export function MissingEnvPage({ missing }: { missing: readonly RequiredConfigKey[] }) {
  return (
    <main>
      <p role="alert">[Error]</p>
      <p> System env missing: </p>
      <ul>
        {missing.map((key) => (
          <li key={key}>{key.toUpperCase()}</li>
        ))}
      </ul>
    </main>
  );
}
