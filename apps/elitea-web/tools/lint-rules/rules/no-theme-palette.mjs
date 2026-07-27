/**
 * R-T7 (spec §4.4, enforcement listed in §3.4's no-restricted-syntax family):
 * components read `theme.vars.palette.*`; `theme.palette.*` is banned outside
 * `shared/brand/` (exempted via config override).
 *
 * Flags:
 *   theme.palette.X            (Identifier `theme`)
 *   useTheme().palette.X       (direct call access)
 * Allows:
 *   theme.vars.palette.X       (the `.vars` hop is the point of R-T7)
 */
export const noThemePalette = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'R-T7: theme.palette.* is banned outside shared/brand/ — read theme.vars.palette.* so values stay CSS-variable-backed',
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        // node = <object>.palette — flag when object is `theme` or `useTheme()`
        if (node.property.type !== 'Identifier' || node.property.name !== 'palette') return;
        const obj = node.object;
        const isThemeIdent = obj.type === 'Identifier' && obj.name === 'theme';
        const isUseThemeCall =
          obj.type === 'CallExpression' &&
          obj.callee.type === 'Identifier' &&
          obj.callee.name === 'useTheme';
        if (isThemeIdent || isUseThemeCall) {
          context.report({
            node,
            message:
              'R-T7: read theme.vars.palette.* (CSS-variable-backed), never theme.palette.* — raw palette access breaks white-labeling outside shared/brand/',
          });
        }
      },
    };
  },
};
