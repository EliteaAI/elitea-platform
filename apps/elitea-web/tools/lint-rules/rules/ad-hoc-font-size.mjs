import { propertyKeyName } from '../lib/ast.mjs';

/**
 * R-T11 (spec §4.4): fontSize comes from a typography variant. Ad-hoc
 * `fontSize:` literals are errors — the old app has 34 distinct values.
 * Member expressions (theme.typography.*, theme.vars.*) pass; the CSS
 * keyword 'inherit' passes (it defers to the variant on the parent).
 */
const FONT_SIZE_KEYS = new Set(['fontSize']);
const TEMPLATE_FONT_SIZE_RE = /font-size\s*:\s*(?!\s*(?:var\(--el-|inherit))[^;{}]*\d/i;

export const adHocFontSize = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'R-T11: ad-hoc fontSize is banned — use a typography variant (Typography variant= / theme.typography.*)',
    },
    schema: [],
  },
  create(context) {
    return {
      Property(node) {
        const key = propertyKeyName(node);
        if (!key || !FONT_SIZE_KEYS.has(key)) return;
        const value = node.value;
        if (value.type !== 'Literal') return;
        const v = value.value;
        const allowedString = typeof v === 'string' && (v === 'inherit' || v.startsWith('var(--el-'));
        if (typeof v === 'number' || (typeof v === 'string' && !allowedString)) {
          context.report({
            node: value,
            message: `R-T11: fontSize: ${JSON.stringify(v)} — sizes come from typography variants, not ad-hoc values`,
          });
        }
      },
      TemplateElement(node) {
        const raw = node.value && (node.value.cooked ?? node.value.raw);
        if (typeof raw === 'string' && TEMPLATE_FONT_SIZE_RE.test(raw)) {
          context.report({
            node,
            message:
              'R-T11: ad-hoc font-size inside a css template — sizes come from typography variants',
          });
        }
      },
    };
  },
};
