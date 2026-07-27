/**
 * Shared AST helpers for the local `elitea` oxlint JS plugin (spec §3.4 as
 * remapped by D2). Rules are written against the standard ESLint rule API and
 * loaded through oxlint's `jsPlugins`.
 *
 * Conventions used by every rule in this plugin:
 *  - no rule options — behaviour is pinned in code so the config cannot drift;
 *  - string checks cover both string Literals and TemplateElement raws, because
 *    the old app hides half its styling offences inside styled`...` templates.
 */

/** True for a string Literal node. */
export function isStringLiteral(node) {
  return node.type === 'Literal' && typeof node.value === 'string';
}

/**
 * Property key name for `{ key: value }` — handles Identifier keys, string
 * Literal keys and (conservatively) nothing else.
 */
export function propertyKeyName(property) {
  if (!property.key) return null;
  if (property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'Literal' && typeof property.key.value === 'string') {
    return property.key.value;
  }
  return null;
}

/**
 * Register visitors that call `check(text, node)` for every string-ish source
 * of text in the file: string literals and template quasis.
 */
export function stringVisitors(check) {
  return {
    Literal(node) {
      if (typeof node.value === 'string') check(node.value, node);
    },
    TemplateElement(node) {
      const raw = node.value && (node.value.cooked ?? node.value.raw);
      if (typeof raw === 'string') check(raw, node);
    },
  };
}

/**
 * Track function nesting with enter/exit visitors so a rule can tell module
 * scope from function scope without relying on parent pointers.
 * Returns { visitors, inFunction } — spread `visitors` into the rule's own.
 */
export function functionDepthTracker() {
  let depth = 0;
  const enter = () => {
    depth += 1;
  };
  const exit = () => {
    depth -= 1;
  };
  return {
    visitors: {
      FunctionDeclaration: enter,
      'FunctionDeclaration:exit': exit,
      FunctionExpression: enter,
      'FunctionExpression:exit': exit,
      ArrowFunctionExpression: enter,
      'ArrowFunctionExpression:exit': exit,
    },
    inFunction: () => depth > 0,
  };
}
