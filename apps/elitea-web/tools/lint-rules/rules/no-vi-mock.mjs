/**
 * R-M1 (spec §6.5): `vi.mock()` of an application module is banned outside
 * `src/**\/__mocks__/` (exempted via config override). This is the single rule
 * that prevents the 11-mock test file (§6.1) from recurring: inside a test the
 * router, query client, stores and theme are real — only the network boundary
 * (MSW) and the socket (in-memory double) are substituted.
 *
 * The narrow sanctioned library exceptions (socket.io-client, browser APIs
 * jsdom lacks) still live in __mocks__/ — the rule stays unconditional here.
 */
const MOCK_METHODS = new Set(['mock', 'doMock', 'doUnmock', 'unmock']);

export const noViMock = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'R-M1: vi.mock of application modules is banned outside src/**/__mocks__/ — mock the network (MSW) and the socket double, nothing else',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'vi' &&
          callee.property.type === 'Identifier' &&
          MOCK_METHODS.has(callee.property.name)
        ) {
          context.report({
            node,
            message: `R-M1: vi.${callee.property.name}() outside __mocks__/ — tests substitute only the network boundary (MSW) and the socket double (§6.2)`,
          });
        }
      },
    };
  },
};
