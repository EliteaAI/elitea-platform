import { isStringLiteral, propertyKeyName } from '../lib/ast.mjs';

/**
 * R-T9 (spec §4.4): spacing uses `theme.spacing(n)` with integer n (or plain
 * numbers in `sx`, which MUI multiplies by the spacing unit). Raw px strings
 * in margin/padding/gap are a lint error — the old app has 301 distinct
 * spacing string values.
 *
 * Covers both object styles (sx / styled objects) and CSS template literals
 * (styled`margin: 12px`).
 */
const SPACING_KEYS = new Set([
  'm', 'mt', 'mb', 'ml', 'mr', 'mx', 'my',
  'p', 'pt', 'pb', 'pl', 'pr', 'px', 'py',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'marginInline', 'marginInlineStart', 'marginInlineEnd',
  'marginBlock', 'marginBlockStart', 'marginBlockEnd',
  'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'paddingInline', 'paddingInlineStart', 'paddingInlineEnd',
  'paddingBlock', 'paddingBlockStart', 'paddingBlockEnd',
  'gap', 'rowGap', 'columnGap',
]);

const PX_VALUE_RE = /\d+(?:\.\d+)?px/;
const TEMPLATE_SPACING_PX_RE =
  /(?:^|[;{\s])(?:margin|padding|gap|row-gap|column-gap)[a-z-]*\s*:[^;{}]*\d+(?:\.\d+)?px/i;

export const rawPxSpacing = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'R-T9: raw px in margin/padding/gap is banned — use theme.spacing(n) or unitless sx numbers',
    },
    schema: [],
  },
  create(context) {
    return {
      Property(node) {
        const key = propertyKeyName(node);
        if (!key || !SPACING_KEYS.has(key)) return;
        if (isStringLiteral(node.value) && PX_VALUE_RE.test(node.value.value)) {
          context.report({
            node: node.value,
            message: `R-T9: ${key}: ${JSON.stringify(node.value.value)} — spacing is theme.spacing(n) or a unitless sx number, never raw px`,
          });
        }
      },
      TemplateElement(node) {
        const raw = node.value && (node.value.cooked ?? node.value.raw);
        if (typeof raw === 'string' && TEMPLATE_SPACING_PX_RE.test(raw)) {
          context.report({
            node,
            message:
              'R-T9: raw px spacing inside a css template — spacing is theme.spacing(n), never raw px',
          });
        }
      },
    };
  },
};
