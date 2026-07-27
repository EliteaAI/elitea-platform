import { propertyKeyName } from '../lib/ast.mjs';

/**
 * R-T10 (spec §4.4): borderRadius uses the radiusSm|Md|Lg tokens only (via
 * theme.vars.shape.* or var(--el-radius-*)). The old app has 71 distinct
 * ad-hoc radius values. Literal numbers and px/percent strings are errors;
 * member expressions (theme.…) and var(--el-…) strings pass.
 */
const RADIUS_KEYS = new Set([
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'borderStartStartRadius',
  'borderStartEndRadius',
  'borderEndStartRadius',
  'borderEndEndRadius',
]);

const ALLOWED_STRING_RE = /^\s*var\(--el-radius-/;
const TEMPLATE_RADIUS_RE = /border(?:-[a-z]+)*-radius\s*:\s*(?!\s*var\(--el-radius-)[^;{}]*\d/i;

export const adHocRadius = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'R-T10: ad-hoc borderRadius is banned — use the radiusSm|Md|Lg tokens (theme.vars.shape.* / var(--el-radius-*))',
    },
    schema: [],
  },
  create(context) {
    return {
      Property(node) {
        const key = propertyKeyName(node);
        if (!key || !RADIUS_KEYS.has(key)) return;
        const value = node.value;
        if (value.type === 'Literal') {
          if (typeof value.value === 'number' || (typeof value.value === 'string' && !ALLOWED_STRING_RE.test(value.value))) {
            context.report({
              node: value,
              message: `R-T10: ${key}: ${JSON.stringify(value.value)} — radii come from the radiusSm|Md|Lg tokens, not ad-hoc values`,
            });
          }
        }
      },
      TemplateElement(node) {
        const raw = node.value && (node.value.cooked ?? node.value.raw);
        if (typeof raw === 'string' && TEMPLATE_RADIUS_RE.test(raw)) {
          context.report({
            node,
            message:
              'R-T10: ad-hoc border-radius inside a css template — radii come from the radiusSm|Md|Lg tokens',
          });
        }
      },
    };
  },
};
