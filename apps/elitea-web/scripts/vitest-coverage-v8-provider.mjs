import { extname } from 'node:path';
import { parseAstAsync } from 'vitest/node';
import { V8CoverageProvider } from '@vitest/coverage-v8/dist/provider.js';
import astV8ToIstanbul from 'ast-v8-to-istanbul';

function parserOptionsFor(filename) {
  const ext = extname(filename).toLowerCase();
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') {
    return { lang: 'ts' };
  }
  if (ext === '.tsx' || ext === '.jsx') {
    return { lang: 'tsx' };
  }
  return undefined;
}

/**
 * Extracted predicate helpers so ignoreNode stays under the complexity budget.
 * Each function checks one Vite/SSR artefact node pattern.
 */
function isViteSSRImportVar(node) {
  return (
    node.type === 'VariableDeclarator'
    && node.id.type === 'Identifier'
    && node.id.name.startsWith('__vite_ssr_import_')
  );
}

function isViteSSRExportsAssign(node) {
  return (
    node.type === 'ExpressionStatement'
    && node.expression.type === 'AssignmentExpression'
    && node.expression.left.type === 'MemberExpression'
    && node.expression.left.object.type === 'Identifier'
    && node.expression.left.object.name === '__vite_ssr_exports__'
  );
}

function isViteSSRDefaultExport(node) {
  return (
    node.type === 'VariableDeclarator'
    && node.id.type === 'Identifier'
    && node.id.name === '__vite_ssr_export_default__'
  );
}

function isViteCjsImportEsModule(node) {
  return (
    node.type === 'ConditionalExpression'
    && node.test.type === 'MemberExpression'
    && node.test.object.type === 'Identifier'
    && node.test.object.name.startsWith('__vite__cjsImport')
    && node.test.property.type === 'Identifier'
    && node.test.property.name === '__esModule'
  );
}

function isVitestConditionalInSSR(node) {
  return (
    node.type === 'IfStatement'
    && node.test.type === 'MemberExpression'
    && node.test.property.type === 'Identifier'
    && node.test.property.name === 'vitest'
  );
}

function isImportMetaEnvAssign(node) {
  return (
    node.type === 'ExpressionStatement'
    && node.expression.type === 'AssignmentExpression'
    && node.expression.left.type === 'MemberExpression'
    && node.expression.left.object.type === 'MetaProperty'
    && node.expression.left.object.meta.name === 'import'
    && node.expression.left.object.property.name === 'meta'
    && node.expression.left.property.type === 'Identifier'
    && node.expression.left.property.name === 'env'
  );
}

function isImportMetaStatement(node) {
  return (
    node.type === 'ExpressionStatement'
    && node.expression.type === 'AssignmentExpression'
    && node.expression.left.type === 'MemberExpression'
    && node.expression.left.object.type === 'MetaProperty'
    && node.expression.left.object.meta.name === 'import'
    && node.expression.left.object.property.name === 'meta'
  );
}

function isTsDecorateCall(node) {
  return (
    node.type === 'ExpressionStatement'
    && node.expression.type === 'CallExpression'
    && node.expression.callee.type === 'Identifier'
    && node.expression.callee.name === '_ts_decorate'
  );
}

function ignoreNode(node, type) {
  if (type === 'statement') {
    if (node.type === 'VariableDeclarator' && isViteSSRImportVar(node)) return true;
    if (isViteSSRExportsAssign(node)) return true;
    if (node.type === 'VariableDeclarator' && isViteSSRDefaultExport(node)) return true;
    if (isImportMetaEnvAssign(node)) return true;
    if (isImportMetaStatement(node)) return true;
  }
  if ((type === 'branch' || type === 'statement')) {
    if (isVitestConditionalInSSR(node)) return 'ignore-this-and-nested-nodes';
  }
  if (type === 'branch' && isViteCjsImportEsModule(node)) return true;
  if (type === 'statement' && isTsDecorateCall(node)) return 'ignore-this-and-nested-nodes';
  return false;
}

class V8CoverageProviderWithTsxSupport extends V8CoverageProvider {
  async remapCoverage(filename, wrapperLength, result, functions) {
    let ast;
    try {
      ast = await parseAstAsync(result.code, parserOptionsFor(filename));
    } catch (error) {
      this.ctx.logger.error(`Failed to parse ${filename}. Excluding it from coverage.\n`, error);
      return {};
    }
    return await astV8ToIstanbul({
      code: result.code,
      sourceMap: result.map,
      ast,
      coverage: {
        functions,
        url: filename,
      },
      ignoreClassMethods: this.options.ignoreClassMethods,
      wrapperLength,
      ignoreNode,
    });
  }
}

const mod = {
  async getProvider() {
    return new V8CoverageProviderWithTsxSupport();
  },
};

export default mod;
