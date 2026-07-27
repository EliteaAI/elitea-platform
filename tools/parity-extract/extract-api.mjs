// §8.3 step 3 — API endpoints: one item per RTK Query endpoint definition in
// the injectEndpoints modules, plus the raw fetch / XHR / axios transports of
// spec §5.7. Template-literal URLs are resolved to a static shape with
// {param} placeholders; genuinely dynamic paths are marked dynamic.
import path from 'node:path';
import {
  API_MODULE_MAP, BASELINE, allSourceFiles, parseFile, rel, src, traverse, writeOut,
} from './common.mjs';

const endpoints = [];
const rawTransports = [];

function resolveUrl(node, consts, dyn) {
  if (!node) return null;
  switch (node.type) {
    case 'StringLiteral':
      return node.value;
    case 'TemplateLiteral': {
      let out = '';
      node.quasis.forEach((q, i) => {
        out += q.value.cooked;
        if (i < node.expressions.length) out += placeholder(node.expressions[i], consts, dyn);
      });
      return out;
    }
    case 'BinaryExpression':
      if (node.operator === '+')
        return `${resolveUrl(node.left, consts, dyn)}${resolveUrl(node.right, consts, dyn)}`;
      dyn.flag = true;
      return '{expr}';
    case 'Identifier':
      // plain identifier interpolation is a path parameter, not a dynamic path
      if (consts.has(node.name)) return consts.get(node.name);
      return `{${node.name}}`;
    case 'ConditionalExpression':
      dyn.flag = true;
      return `{${resolveUrl(node.consequent, consts, dyn)}|${resolveUrl(node.alternate, consts, dyn)}}`;
    default:
      return placeholder(node, consts, dyn);
  }
}

function placeholder(expr, consts, dyn) {
  switch (expr.type) {
    case 'Identifier':
      if (consts.has(expr.name)) return consts.get(expr.name);
      return `{${expr.name}}`;
    case 'MemberExpression':
      return `{${expr.property.name || 'expr'}}`;
    case 'CallExpression': {
      // encodeURI(x), encodeURIComponent(x), params.toString()
      const c = expr.callee;
      if (c.type === 'Identifier' && /^encodeURI/.test(c.name) && expr.arguments[0])
        return placeholder(expr.arguments[0], consts, dyn);
      if (c.type === 'MemberExpression' && c.property.name === 'toString')
        return placeholder(c.object, consts, dyn);
      dyn.flag = true;
      return '{expr}';
    }
    case 'StringLiteral':
      return expr.value;
    default:
      dyn.flag = true;
      return '{expr}';
  }
}

function moduleConsts(ast) {
  const consts = new Map();
  traverse(ast, {
    VariableDeclarator(p) {
      if (p.parentPath.parentPath.node.type !== 'Program' && p.parentPath.parentPath.node.type !== 'ExportNamedDeclaration') return;
      if (p.node.id.type === 'Identifier' && p.node.init && p.node.init.type === 'StringLiteral')
        consts.set(p.node.id.name, p.node.init.value);
    },
  });
  return consts;
}

function extractEndpoint(name, callNode, r, consts) {
  const defObj = callNode.arguments[0];
  const kind = callNode.callee.property.name; // query | mutation
  const line = callNode.loc.start.line;
  const endLine = callNode.loc.end.line;
  let method = kind === 'mutation' ? null : 'GET';
  let url = null;
  const dyn = { flag: false };
  let paramKeys = [];

  const findReturn = fn => {
    if (!fn) return null;
    if (fn.body.type !== 'BlockStatement') return fn.body;
    let ret = null;
    // last ReturnStatement wins (shallow scan)
    const stack = [fn.body];
    while (stack.length) {
      const n = stack.pop();
      if (n.type === 'ReturnStatement') ret = n.argument;
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (Array.isArray(v)) v.forEach(x => x && x.type && x.type !== 'ArrowFunctionExpression' && x.type !== 'FunctionExpression' && stack.push(x));
        else if (v && v.type && v.type !== 'ArrowFunctionExpression' && v.type !== 'FunctionExpression') stack.push(v);
      }
    }
    return ret;
  };

  // collect local string-ish const initializers inside a fn body so that
  // `const url = cond ? \`a\` : \`b\`` style shapes resolve instead of {url}
  const collectLocals = fnNode => {
    const localConsts = new Map(consts);
    traverse(fnNode, {
      noScope: true,
      VariableDeclarator(p2) {
        if (p2.node.id.type !== 'Identifier' || !p2.node.init) return;
        const t = p2.node.init.type;
        if (t === 'StringLiteral' || t === 'TemplateLiteral' || t === 'BinaryExpression' || t === 'ConditionalExpression') {
          const d2 = { flag: false };
          const v = resolveUrl(p2.node.init, localConsts, d2);
          if (v) localConsts.set(p2.node.id.name, v);
        }
      },
    });
    return localConsts;
  };

  for (const prop of defObj.properties) {
    if (prop.type !== 'ObjectProperty') continue;
    const key = prop.key.name || prop.key.value;
    if (key === 'query') {
      const localConsts = collectLocals(prop.value);
      const ret = findReturn(prop.value);
      if (ret && ret.type === 'ObjectExpression') {
        // resolve url against locals too
        for (const pp of ret.properties) {
          if (pp.type !== 'ObjectProperty') continue;
          const k = pp.key.name || pp.key.value;
          if (k === 'url') url = resolveUrl(pp.value, localConsts, dyn);
          if (k === 'method' && pp.value.type === 'StringLiteral') method = pp.value.value;
          if (k === 'params' && pp.value.type === 'ObjectExpression')
            paramKeys = pp.value.properties.filter(x => x.type === 'ObjectProperty').map(x => x.key.name || x.key.value);
        }
      } else if (ret) {
        url = resolveUrl(ret, localConsts, dyn);
        method = method || 'GET';
      }
      if (method === null) method = 'GET';
    } else if (key === 'queryFn') {
      // raw fetch(url) or baseQuery({url, method}) inside.
      // Local `const url = \`...\`` initializers are resolved first, so a
      // fetch(url) call recovers the real template shape instead of {url}.
      const localConsts = new Map(consts);
      traverse(prop.value, {
        noScope: true,
        VariableDeclarator(p2) {
          if (p2.node.id.type !== 'Identifier' || !p2.node.init) return;
          const t = p2.node.init.type;
          if (t === 'StringLiteral' || t === 'TemplateLiteral' || t === 'BinaryExpression') {
            const d2 = { flag: false };
            const v = resolveUrl(p2.node.init, localConsts, d2);
            if (v) localConsts.set(p2.node.id.name, v);
          }
        },
      });
      let found = null;
      const fnPath = prop;
      traverse(fnPath.value, {
        noScope: true,
        CallExpression(p2) {
          if (found) return;
          const callee = p2.node.callee;
          if (callee.type === 'Identifier' && callee.name === 'fetch') {
            found = { url: resolveUrl(p2.node.arguments[0], localConsts, dyn), method: 'GET', via: 'raw fetch' };
            const opts = p2.node.arguments[1];
            if (opts && opts.type === 'ObjectExpression')
              for (const pp of opts.properties)
                if (pp.type === 'ObjectProperty' && (pp.key.name || pp.key.value) === 'method' && pp.value.type === 'StringLiteral')
                  found.method = pp.value.value;
          } else if (callee.type === 'Identifier' && callee.name === 'baseQuery' && p2.node.arguments[0] && p2.node.arguments[0].type === 'ObjectExpression') {
            found = { url: null, method: 'GET', via: 'baseQuery' };
            for (const pp of p2.node.arguments[0].properties) {
              if (pp.type !== 'ObjectProperty') continue;
              const k = pp.key.name || pp.key.value;
              if (k === 'url') found.url = resolveUrl(pp.value, localConsts, dyn);
              if (k === 'method' && pp.value.type === 'StringLiteral') found.method = pp.value.value;
            }
          }
        },
      });
      if (found) {
        url = found.url;
        method = found.method;
      } else {
        dyn.flag = true;
        url = url || 'DYNAMIC(queryFn)';
        method = method || 'CUSTOM';
      }
    }
  }
  if (url === null) {
    dyn.flag = true;
    url = 'DYNAMIC';
    method = method || 'CUSTOM';
  }
  return {
    module: r, endpoint: name, type: kind, method, url,
    dynamic: dyn.flag, params: paramKeys, line, endLine,
  };
}

for (const [modRel, meta] of Object.entries(API_MODULE_MAP)) {
  const { ast } = parseFile(path.join(BASELINE, modRel));
  if (!ast) throw new Error(`cannot parse ${modRel}`);
  const consts = moduleConsts(ast);
  traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee;
      if (callee.type !== 'MemberExpression' || callee.property.name !== 'injectEndpoints') return;
      const cfg = p.node.arguments[0];
      const endpointsProp = cfg.properties.find(pp => (pp.key.name || pp.key.value) === 'endpoints');
      const ret = endpointsProp.value.body; // build => ({...})
      const obj = ret.type === 'ObjectExpression' ? ret : null;
      if (!obj) throw new Error(`${modRel}: endpoints body is not an object literal`);
      for (const prop of obj.properties) {
        if (prop.type !== 'ObjectProperty' || prop.value.type !== 'CallExpression') continue;
        const name = prop.key.name || prop.key.value;
        endpoints.push({ ...extractEndpoint(name, prop.value, modRel, consts), ...meta });
      }
    },
  });
}

// --- §5.7 raw transports outside the RTK layer ------------------------------
const RTK_MODULES = new Set(Object.keys(API_MODULE_MAP));
for (const f of allSourceFiles()) {
  const r = rel(f);
  if (RTK_MODULES.has(r) || r === 'src/api/eliteaApi.js') continue;
  const { ast } = parseFile(f);
  if (!ast) continue;
  const consts = moduleConsts(ast);
  traverse(ast, {
    NewExpression(p) {
      if (p.node.callee.name === 'XMLHttpRequest')
        rawTransports.push({ transport: 'XMLHttpRequest', module: r, line: p.node.loc.start.line, url: null, method: null });
    },
    CallExpression(p) {
      const callee = p.node.callee;
      const dyn = { flag: false };
      if (callee.type === 'Identifier' && callee.name === 'fetch') {
        rawTransports.push({
          transport: 'fetch', module: r, line: p.node.loc.start.line,
          url: resolveUrl(p.node.arguments[0], consts, dyn), dynamic: dyn.flag,
        });
      } else if (callee.type === 'MemberExpression' && callee.object.name === 'axios') {
        rawTransports.push({
          transport: 'axios', module: r, line: p.node.loc.start.line,
          method: callee.property.name.toUpperCase(),
          url: resolveUrl(p.node.arguments[0], consts, dyn), dynamic: dyn.flag,
        });
      }
    },
  });
}

console.log(`RTK endpoints: ${endpoints.length} across ${new Set(endpoints.map(e => e.module)).size} modules (spec: ~213 across 32)`);
console.log(`raw transports: ${rawTransports.length}`);
writeOut('api.json', { endpoints, rawTransports });
