import { isStringLiteral, propertyKeyName, stringVisitors } from '../lib/ast.mjs';

/**
 * R-T1 (spec §3.4 / §4.6 check 1): no raw colour literal outside
 * `shared/brand/tokens/` (that path is exempted via a config override, not
 * here). Catches:
 *   - hex colours (#rgb #rgba #rrggbb #rrggbbaa) in any string/template
 *   - colour functions rgb()/rgba()/hsl()/hsla()/oklch()/oklab()/color-mix()
 *   - named CSS colours, but only as the value of a colour-bearing style key,
 *     so `status === 'red'` prose does not false-positive.
 * The old app carries 483 hex + 322 rgb literals; this is the fence.
 *
 * One documented exemption: an issue-tracker reference such as `issue #130` is
 * not a colour. See ISSUE_CUE_RE below for the exact, deliberately narrow
 * conditions, and for the incident that produced it (issue #189).
 */

const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const FUNC_RE = /\b(?:rgba?|hsla?|oklch|oklab|color-mix)\s*\(/;

/**
 * Issue-tracker references are not colours (issue #189).
 *
 * `#130` is a syntactically valid three-digit hex colour, so length alone
 * cannot separate it from `issue #130`. It reached this rule for real: an
 * `issue #130` reference in services/elitea-main/api/openapi/v2.yaml flowed
 * through orval into a generated `.describe()` string, and the theme gate
 * failed the build on an API description. The author reworded the prose to
 * "issue 130". That is the wrong direction: a false positive must not change
 * the prose.
 *
 * The exemption is deliberately narrow. A matcher that is made wider until it
 * reports nothing is the worse defect. TWO conditions must both hold:
 *
 *   1. The token carries NO hex letter (a–f/A–F). An issue number is decimal,
 *      so `#c428dd`, `#fff` and `#abc` stay findings in every context. This is
 *      the property that stops the exemption from widening.
 *   2. The token sits in one of three reference shapes:
 *      a. a cue word directly in front of it — `issue #130`, `PR #130`,
 *         `see #130`, `fixes #130`;
 *      b. the parenthesised short form `(#130)`, closing bracket required.
 *         The bracket matters: `linear-gradient(#130, #240)` keeps both
 *         findings;
 *      c. the title form — the token opens the string and prose follows it,
 *         as in `describe('#413 — a failed list read renders an error')`.
 *         "Prose follows" means the next characters are NOT the continuation
 *         of a CSS value; see CSS_CONTINUATION_RE, which keeps
 *         `'#130 0 0 2px'`, `'#130 inset'` and `'#130 !important'` findings.
 *
 * Anything else is still reported: `'#130'` on its own, `color: '#130'`,
 * `'1px solid #130'`, and any `#130` that follows an ordinary word.
 */
const DECIMAL_TOKEN_RE = /^#[0-9]+$/;
const ISSUE_CUE_RE =
  /(?:\b(?:issues?|prs?|pull\s+requests?|gh|see|fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved|revert|reverts|reverted)\s+)$/i;
/**
 * What may follow a colour inside a CSS value: a number or a length, another
 * value separator, `!important`, or a border/shadow keyword. Prose — an em
 * dash, or a letter word that is not one of these keywords — may not.
 */
const CSS_CONTINUATION_RE =
  /^\s+(?:[+.\d,;)}\]]|!|(?:inset|solid|dashed|dotted|double|groove|ridge|outset|none|important)\b)/i;

function isIssueReference(text, match) {
  if (!DECIMAL_TOKEN_RE.test(match[0])) return false;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  if (ISSUE_CUE_RE.test(before)) return true;
  if (before.endsWith('(') && after.startsWith(')')) return true;
  // Title form: the token opens the string and prose follows it.
  return before === '' && /^\s/.test(after) && !CSS_CONTINUATION_RE.test(after);
}

const COLOR_BEARING_KEYS = new Set([
  'color',
  'background',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'textDecorationColor',
  'caretColor',
  'fill',
  'stroke',
  'boxShadow',
  'accentColor',
]);

// The 16 basic + frequently-abused extended CSS named colours. Deliberately
// NOT the full 148-name list: names like 'tan' or 'linen' are common English
// words and would false-positive; the measured offences in the old app are
// all from this set. 'transparent'/'currentColor'/'inherit' are keywords, not
// colours, and stay allowed ('currentColor' is the R-T8 mechanism).
const NAMED_COLORS = new Set([
  'black', 'silver', 'gray', 'grey', 'white', 'maroon', 'red', 'purple',
  'fuchsia', 'green', 'lime', 'olive', 'yellow', 'navy', 'blue', 'teal',
  'aqua', 'orange', 'cyan', 'magenta', 'pink', 'brown', 'gold', 'darkgray',
  'darkgrey', 'lightgray', 'lightgrey', 'darkblue', 'lightblue', 'darkred',
  'lightgreen', 'darkgreen', 'whitesmoke', 'gainsboro', 'crimson', 'indigo',
  'violet', 'coral', 'salmon', 'khaki', 'lavender', 'beige', 'ivory',
]);

export const noRawColor = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'R-T1: raw colour literals are banned outside shared/brand/tokens/ — use brand tokens (theme.vars / --el-*)',
    },
    schema: [],
  },
  create(context) {
    const report = (node, sample) => {
      context.report({
        node,
        message: `R-T1: raw colour literal ${JSON.stringify(sample)} — colours come from brand tokens (theme.vars.palette.* / var(--el-*)), never literals`,
      });
    };

    const checkText = (text, node) => {
      for (const match of text.matchAll(HEX_RE)) {
        if (isIssueReference(text, match)) continue;
        return report(node, match[0]);
      }
      const fn = text.match(FUNC_RE);
      if (fn) return report(node, `${fn[0]})…`);
    };

    return {
      ...stringVisitors(checkText),
      Property(node) {
        const key = propertyKeyName(node);
        if (!key || !COLOR_BEARING_KEYS.has(key)) return;
        if (isStringLiteral(node.value)) {
          const value = node.value.value.trim().toLowerCase();
          if (NAMED_COLORS.has(value)) report(node.value, node.value.value);
        }
      },
    };
  },
};
