import { stringVisitors } from '../lib/ast.mjs';

/**
 * R-T5 (spec §3.4): `!important` is banned in sx/styled. The only escape is an
 * inline `// oxlint-disable-next-line elitea/no-important-sx` WITH a linked
 * parity-manifest waiver id (review-enforced). The old app has 613.
 *
 * Scans every string/template because `!important` has no legitimate use in
 * any string in this codebase.
 */
export const noImportantSx = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'R-T5: !important is banned in sx/styled; escape requires a disable comment with a parity-manifest waiver id',
    },
    schema: [],
  },
  create(context) {
    return stringVisitors((text, node) => {
      if (text.includes('!important')) {
        context.report({
          node,
          message:
            'R-T5: !important is banned — fix the specificity fight; escape only with a disable comment linked to a parity-manifest waiver id',
        });
      }
    });
  },
};
