/**
 * STOR-1 member-expression half (spec §5.4), added by issue #22.
 *
 * `eslint/no-restricted-globals` already bans the BARE `localStorage` /
 * `sessionStorage` globals, but it matches unresolved identifiers only — it
 * is blind to the equivalent member-expression spelling `window.sessionStorage`
 * / `globalThis.localStorage`. `features/toolkits/sharepoint`'s
 * `mcpTokenStorage.helpers.ts` used exactly that spelling to persist OAuth
 * access tokens under a raw, un-namespaced key, so:
 *
 *   - `clearNamespace()` (which sweeps only `el.*`) never cleared them and the
 *     tokens survived logout, and
 *   - §5.4's own completeness test could not see it, because that test
 *     enumerates writes made THROUGH `shared/lib/storage.ts`'s wrapper.
 *
 * STOR-1's self-test fixture only ever exercised the bare-global spelling, so
 * the gate reported green while the hole was open. This rule closes it.
 *
 * Scope: `src/**` production code. Test/spec/story files are skipped here
 * (they legitimately reach for `window.sessionStorage.clear()` to reset
 * state), and `shared/lib/storage.ts` plus the jsdom web-storage shims are
 * turned off by config override in `.oxlintrc.json`.
 */
const STORAGE_PROPERTIES = new Set(['localStorage', 'sessionStorage']);
const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self']);
const TEST_FILE_RE = /\.(test|spec|stories)\.[cm]?[jt]sx?$/;

export const noRawWebstorage = {
  meta: {
    type: 'problem',
    docs: {
      description:
        '§5.4: window/globalThis.localStorage|sessionStorage is banned — storage goes through shared/lib/storage.ts under the el.* namespace',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? '';
    if (TEST_FILE_RE.test(filename)) return {};

    return {
      MemberExpression(node) {
        if (node.computed) return;
        if (node.object.type !== 'Identifier' || !GLOBAL_OBJECTS.has(node.object.name)) return;
        if (node.property.type !== 'Identifier' || !STORAGE_PROPERTIES.has(node.property.name)) return;

        context.report({
          node,
          message: `§5.4: ${node.object.name}.${node.property.name} — storage goes through shared/lib/storage.ts (createStorage) so logout's clearNamespace() actually clears it`,
        });
      },
    };
  },
};
