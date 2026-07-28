import { linter, type Diagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { YAMLException, load } from 'js-yaml';

/** `markClass` CM6 attaches to the diagnostic's marked span — styled by `YamlCodeEditor`'s wrapping `Box`. */
export const YAML_ERROR_MARK_CLASS = 'error_yaml_code';

/**
 * A `@codemirror/lint` `linter()` extension that flags the current document
 * as invalid YAML, ported from the `yamlLinter` defined inline in
 * `apps/elitea-ui/src/[fsd]/shared/lib/helpers/codeMirrorLinter.helpers.js`
 * (lines 47-64) — same `js-yaml` `load()`-then-catch approach, same
 * `markClass` value, same "mark the whole offending line" span (via
 * `view.lineBlockAt`).
 *
 * SCOPE NOTE: only the *linter* half of that baseline helper is ported here.
 * The baseline's YAML *syntax highlighting* came from
 * `StreamLanguage.define(yaml)` (`@codemirror/legacy-modes/mode/yaml`), and
 * `useLanguageLinter.hooks.js` (the baseline hook dispatching to 25+
 * languages via `getExtensionsByLang`) is a broad, general-purpose
 * `shared/lib` capability, not a `pipelines`-domain one — neither
 * `@codemirror/legacy-modes` nor the multi-language dispatcher exists in
 * this app (confirmed: not in `package.json`, not under `src/shared/lib/`;
 * unit S3's "shared/lib pure helpers" pass did not port it). Adding a new
 * `package.json` dependency from this sub-unit was avoided deliberately —
 * this worktree is shared with 28 concurrent Wave-2 sub-units, and
 * `CodeMirrorEditor.tsx` (unit S1-E)'s own doc comment already set the
 * precedent of dropping a baseline feature that needs an uninstalled
 * package (`@uiw/codemirror-theme-vscode`) rather than adding one. YAML
 * text in `YamlCodeEditor` therefore renders unhighlighted (plain text,
 * still readable via `CodeMirrorEditor`'s own `highlightStyle` base
 * colours) but is still linted with the same error messages and the same
 * red-highlight `markClass` the baseline used.
 *
 * `js-yaml` itself IS an installed dependency (`package.json`, `5.2.2` —
 * verified against the baseline's `js-yaml` import) with the same
 * `load()`/`YAMLException`/`mark.position` API this code relies on.
 *
 * Fix over the baseline: `YAML.load(view.state.doc)` passed a CM6 `Text`
 * object directly, not a string — `js-yaml`'s `load()` requires a real
 * `string` (verified against `node_modules/js-yaml/dist/js-yaml.d.ts`:
 * `declare function load(input: string, ...)`). This calls
 * `view.state.doc.toString()` explicitly instead. Also clamps the error
 * mark's `position` to the document length before calling
 * `view.lineBlockAt`, which throws a `RangeError` for any out-of-range
 * position (the baseline's bare `loc?.position || 0` had no such guard).
 */
export function createYamlLinter(): Extension {
  return linter((view): Diagnostic[] => {
    try {
      load(view.state.doc.toString());

      return [];
    } catch (error) {
      // Defense-in-depth, not a reachable branch for real input: `js-yaml`'s
      // `load()` (verified against `node_modules/js-yaml/dist/js-yaml.d.ts`
      // and its own source) only ever throws `YAMLException` for malformed
      // YAML text, and `view.state.doc.toString()` above always hands it a
      // real `string`. Kept as a guard rather than an assertion so a future
      // `js-yaml` upgrade that starts throwing something else fails silent
      // (no diagnostics) instead of crashing the editor.
      /* v8 ignore next 3 */
      if (!(error instanceof YAMLException)) {
        return [];
      }

      const rawPosition = error.mark?.position ?? 0;
      const position = Math.min(Math.max(rawPosition, 0), view.state.doc.length);
      const lineBlock = view.lineBlockAt(position);

      return [
        {
          from: lineBlock.from,
          to: lineBlock.to,
          message: error.message,
          severity: 'error',
          markClass: YAML_ERROR_MARK_CLASS,
        },
      ];
    }
  });
}
