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
      ignoreNode: (node, type) => {
        if (type === 'statement' && node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.id.name.startsWith('__vite_ssr_import_')) {
          return true;
        }
        if (type === 'statement' && node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression' && node.expression.left.type === 'MemberExpression' && node.expression.left.object.type === 'Identifier' && node.expression.left.object.name === '__vite_ssr_exports__') {
          return true;
        }
        if (type === 'statement' && node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.id.name === '__vite_ssr_export_default__') {
          return true;
        }
        if (type === 'branch' && node.type === 'ConditionalExpression' && node.test.type === 'MemberExpression' && node.test.object.type === 'Identifier' && node.test.object.name.startsWith('__vite__cjsImport') && node.test.property.type === 'Identifier' && node.test.property.name === '__esModule') {
          return true;
        }
        if ((type === 'branch' || type === 'statement') && node.type === 'IfStatement' && node.test.type === 'MemberExpression' && node.test.property.type === 'Identifier' && node.test.property.name === 'vitest') {
          if (node.test.object.type === 'Identifier' && node.test.object.name === '__vite_ssr_import_meta__') {
            return 'ignore-this-and-nested-nodes';
          }
          if (node.test.object.type === 'MetaProperty' && node.test.object.meta.name === 'import' && node.test.object.property.name === 'meta') {
            return 'ignore-this-and-nested-nodes';
          }
        }
        if (type === 'statement' && node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression' && node.expression.left.type === 'MemberExpression' && node.expression.left.object.type === 'MetaProperty' && node.expression.left.object.meta.name === 'import' && node.expression.left.object.property.name === 'meta' && node.expression.left.property.type === 'Identifier' && node.expression.left.property.name === 'env') {
          return true;
        }
        if (type === 'statement' && node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression' && node.expression.left.type === 'MemberExpression' && node.expression.left.object.type === 'Identifier' && node.expression.left.object.name === '__vite_ssr_import_meta__') {
          return true;
        }
        if (type === 'statement' && node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression' && node.expression.callee.type === 'Identifier' && node.expression.callee.name === '_ts_decorate') {
          return 'ignore-this-and-nested-nodes';
        }
      },
    });
  }
}

const mod = {
  async getProvider() {
    return new V8CoverageProviderWithTsxSupport();
  }
};

export default mod;
