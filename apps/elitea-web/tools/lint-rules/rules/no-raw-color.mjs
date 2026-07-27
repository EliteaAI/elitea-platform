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
 */

const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
const FUNC_RE = /\b(?:rgba?|hsla?|oklch|oklab|color-mix)\s*\(/;

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
      const hex = text.match(HEX_RE);
      if (hex) return report(node, hex[0]);
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
