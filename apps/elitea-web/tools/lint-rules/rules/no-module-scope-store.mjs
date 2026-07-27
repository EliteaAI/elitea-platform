import { functionDepthTracker } from '../lib/ast.mjs';

/**
 * R-S2 (spec §3.4): no zustand store may be created at module scope. Stores
 * are created in a factory and injected, which kills the old app's
 * order-dependent bootstrap ("Important! Need to have been already imported
 * all APIs before the store will be created", store.js:7-8).
 *
 * Tracks the local bindings of `create`/`createStore` imported from zustand
 * and flags calls to them (including the curried `create<T>()(init)` form)
 * that are not inside any function.
 */
const ZUSTAND_SOURCES = new Set(['zustand', 'zustand/vanilla', 'zustand/traditional']);
const CREATOR_EXPORTS = new Set(['create', 'createStore', 'createWithEqualityFn', 'default']);

export const noModuleScopeStore = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'R-S2: zustand stores may not be created at module scope — wrap in a factory and inject from app/',
    },
    schema: [],
  },
  create(context) {
    const creatorLocals = new Set();
    const depth = functionDepthTracker();

    const isCreatorCallee = (callee) => {
      // create(...) / createStore(...)
      if (callee.type === 'Identifier' && creatorLocals.has(callee.name)) return true;
      // curried form: create<T>()(initializer) — callee is itself a call to a creator
      if (
        callee.type === 'CallExpression' &&
        callee.callee.type === 'Identifier' &&
        creatorLocals.has(callee.callee.name)
      ) {
        return true;
      }
      return false;
    };

    return {
      ...depth.visitors,
      ImportDeclaration(node) {
        if (!ZUSTAND_SOURCES.has(node.source.value)) return;
        for (const spec of node.specifiers) {
          if (spec.type === 'ImportDefaultSpecifier') {
            creatorLocals.add(spec.local.name);
          } else if (
            spec.type === 'ImportSpecifier' &&
            spec.imported.type === 'Identifier' &&
            CREATOR_EXPORTS.has(spec.imported.name)
          ) {
            creatorLocals.add(spec.local.name);
          }
        }
      },
      CallExpression(node) {
        if (depth.inFunction()) return;
        if (isCreatorCallee(node.callee)) {
          context.report({
            node,
            message:
              'R-S2: store created at module scope — export a factory (createXxxStore) and construct it in app/ so bootstrap order is explicit',
          });
        }
      },
    };
  },
};
