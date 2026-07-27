/**
 * R-L4 (spec §3.4): `export *` is banned. oxlint 1.75 has no native
 * `no-restricted-syntax`, so this is a local rule (probed: the eslint plugin
 * rejects both `no-restricted-syntax` and a hypothetical `no-export-all`).
 * The old app's 215 pure re-export barrels are a direct cause of the 71%
 * cross-domain coupling (§10.1); slice `index.ts` files re-export named
 * symbols only (§3.3).
 */
export const noExportAll = {
  meta: {
    type: 'problem',
    docs: {
      description: 'R-L4: export * is banned — slice public APIs re-export named symbols only',
    },
    schema: [],
  },
  create(context) {
    return {
      ExportAllDeclaration(node) {
        context.report({
          node,
          message:
            'R-L4: export * is banned — re-export the named symbols you mean to expose (§3.3: index.ts is a curated public API, not a barrel)',
        });
      },
    };
  },
};
