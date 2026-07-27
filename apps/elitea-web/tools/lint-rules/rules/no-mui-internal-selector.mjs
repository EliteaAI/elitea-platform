import { stringVisitors } from '../lib/ast.mjs';

/**
 * R-T6 (spec §3.4 / §4.6 check 4): deep `.Mui<Component>-<slot>` and Emotion
 * `.css-<hash>` selectors are banned outside `shared/brand/mui-overrides/`
 * (exempted via config override). The old app has 564 of these, including a
 * literal Emotion content hash (`'& .css-tgsonj'`, waiver W-004).
 */

const MUI_SELECTOR_RE = /\.Mui[A-Za-z]+-[A-Za-z0-9]/;
const EMOTION_HASH_RE = /\.css-[a-z0-9]{5,}/;

export const noMuiInternalSelector = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'R-T6: deep .Mui*-*/.css-* internal-DOM selectors are banned outside shared/brand/mui-overrides/',
    },
    schema: [],
  },
  create(context) {
    return stringVisitors((text, node) => {
      const match = text.match(MUI_SELECTOR_RE) ?? text.match(EMOTION_HASH_RE);
      if (match) {
        context.report({
          node,
          message: `R-T6: internal MUI/Emotion selector ${JSON.stringify(match[0])} — override components only in shared/brand/mui-overrides/ (one file per component key)`,
        });
      }
    });
  },
};
