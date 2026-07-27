/**
 * R-T2 (spec §3.4 / §4.6 check 2): no `palette.mode === …` /
 * `isDarkMode ? …` branch anywhere. Colour schemes are resolved by CSS
 * variables (`colorSchemes` + `[data-el-scheme]`), never by JS branches.
 * The theme-gate grep (§4.6 check 2) is the linter-independent backstop.
 * The old app has 52 mode branches in 20 files.
 */
export const noModeBranch = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'R-T2: no palette.mode ===/!== or isDarkMode ? branches — schemes are CSS-variable-resolved, not JS-branched',
    },
    schema: [],
  },
  create(context) {
    const isPaletteModeAccess = (node) =>
      node.type === 'MemberExpression' &&
      node.property.type === 'Identifier' &&
      node.property.name === 'mode' &&
      node.object.type === 'MemberExpression' &&
      node.object.property.type === 'Identifier' &&
      node.object.property.name === 'palette';

    const isDarkModeIdent = (node) =>
      (node.type === 'Identifier' && node.name === 'isDarkMode') ||
      (node.type === 'MemberExpression' &&
        node.property.type === 'Identifier' &&
        node.property.name === 'isDarkMode');

    return {
      BinaryExpression(node) {
        if (node.operator !== '===' && node.operator !== '!==') return;
        if (isPaletteModeAccess(node.left) || isPaletteModeAccess(node.right)) {
          context.report({
            node,
            message:
              'R-T2: palette.mode comparison — express both schemes as tokens; the CSS variable layer picks the value',
          });
        }
      },
      ConditionalExpression(node) {
        if (isDarkModeIdent(node.test)) {
          context.report({
            node: node.test,
            message:
              'R-T2: isDarkMode ? branch — express both schemes as tokens; the CSS variable layer picks the value',
          });
        }
      },
    };
  },
};
