// §8.3 step 6 — user-visible actions: scripted scan of JSX handler props
// (onClick / onSubmit and, as a documented superset, every on[A-Z]* handler
// prop) whose handler dispatches an RTK mutation. Resolution is two-pass:
//   pass A: every custom hook (use[A-Z]*) that transitively references a
//           use*Mutation trigger is recorded as a provider of its endpoints;
//   pass B: JSX handler props resolve through same-file functions (depth <=4)
//           and through pass-A hook results bound in the consuming file.
// Items are deduplicated by (target endpoint × screen); the full mapping is
// emitted for review (referenced from REPRODUCE.md).
import fs from 'node:fs';
import path from 'node:path';
import { OUT, allSourceFiles, parseFile, rel, screenOf, src, traverse, writeOut } from './common.mjs';

const { endpoints } = JSON.parse(fs.readFileSync(path.join(OUT, 'api.json'), 'utf8'));
const endpointByName = new Map();
for (const e of endpoints) {
  if (!endpointByName.has(e.endpoint)) endpointByName.set(e.endpoint, []);
  endpointByName.get(e.endpoint).push(e);
}

// socket channel events (sioEvents keys == values), so an identifier that
// matches an event name inside an emitting function is that event.
const socketCatalogue = new Map(
  JSON.parse(fs.readFileSync(path.join(OUT, 'sockets.json'), 'utf8'))
    .filter(s => s.kind === 'event')
    .map(s => [s.name, s]),
);

// per-file: local names bound to a socket emit for a specific event —
//   const { emit } = useSocket(sioEvents.X, ...)   (emit may be renamed)
function socketBindings(ast) {
  const bound = new Map(); // localName -> 'sio:<event>'
  traverse(ast, {
    VariableDeclarator(p) {
      const init = p.node.init;
      if (!init || init.type !== 'CallExpression' || init.callee.type !== 'Identifier') return;
      if (!/^use(Manual)?Socket$/.test(init.callee.name)) return;
      const arg = init.arguments[0];
      if (!arg || arg.type !== 'MemberExpression' || arg.object.name !== 'sioEvents') return;
      const event = arg.property.name;
      if (!socketCatalogue.has(event)) return;
      if (p.node.id.type !== 'ObjectPattern') return;
      for (const prop of p.node.id.properties) {
        if (prop.type !== 'ObjectProperty' || prop.key.name !== 'emit') continue;
        if (prop.value.type === 'Identifier') bound.set(prop.value.name, `sio:${event}`);
      }
    },
  });
  return bound;
}

// events the FILE actually emits: `<x>.emit(sioEvents.X, ...)` call sites.
// This is the precision guard against crediting receive-side events
// (.on handlers) as user actions: only events with a literal same-file
// emit call may be attributed through the refs heuristic.
function emittedEvents(ast) {
  const out = new Set();
  traverse(ast, {
    CallExpression(p) {
      const c = p.node.callee;
      if (c.type !== 'MemberExpression' || c.property.name !== 'emit') return;
      const a = p.node.arguments[0];
      if (a && a.type === 'MemberExpression' && a.object.name === 'sioEvents' && socketCatalogue.has(a.property.name))
        out.add(a.property.name);
      if (a && a.type === 'StringLiteral' && socketCatalogue.has(a.value)) out.add(a.value);
    },
  });
  return out;
}

// events referenced by a set of identifier refs, counted only when the file
// emits that exact event (sioEvents keys equal their values, so an
// identifier matching an emitted event name is that event)
function socketEventsFromRefs(refs, emitted) {
  const out = new Set();
  for (const n of refs) if (emitted.has(n)) out.add(`sio:${n}`);
  return out;
}

function mutationBindings(ast) {
  const triggers = new Map(); // localName -> endpointName
  traverse(ast, {
    VariableDeclarator(p) {
      const init = p.node.init;
      if (!init || init.type !== 'CallExpression' || init.callee.type !== 'Identifier') return;
      const m = /^use([A-Z]\w*)Mutation$/.exec(init.callee.name);
      if (!m) return;
      const endpointName = m[1][0].toLowerCase() + m[1].slice(1);
      if (!endpointByName.has(endpointName)) return;
      if (p.node.id.type === 'ArrayPattern' && p.node.id.elements[0] && p.node.id.elements[0].type === 'Identifier')
        triggers.set(p.node.id.elements[0].name, endpointName);
    },
  });
  return triggers;
}

// useRef indirections: `const xRef = useRef(x)` then `xRef.current(...)` —
// alias xRef back to x so handler chains survive the ref hop.
function refAliases(ast) {
  const aliases = new Map();
  traverse(ast, {
    VariableDeclarator(p) {
      const init = p.node.init;
      if (!init || init.type !== 'CallExpression' || init.callee.name !== 'useRef') return;
      const a = init.arguments[0];
      if (a && a.type === 'Identifier' && p.node.id.type === 'Identifier')
        aliases.set(p.node.id.name, a.name);
    },
  });
  return aliases;
}

function fnTable(ast, nameSets) {
  // fnName -> {refs:Set<identifier>} for transitive resolution
  const fns = new Map();
  const register = (name, bodyPath) => {
    const refs = new Set();
    bodyPath.traverse({
      Identifier(ip) {
        refs.add(ip.node.name);
      },
    });
    fns.set(name, refs);
  };
  traverse(ast, {
    FunctionDeclaration(p) {
      if (p.node.id) register(p.node.id.name, p);
    },
    VariableDeclarator(p) {
      const init = p.node.init;
      if (!init || p.node.id.type !== 'Identifier') return;
      if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') register(p.node.id.name, p.get('init'));
      else if (init.type === 'CallExpression' && init.callee.name === 'useCallback' && init.arguments[0]) register(p.node.id.name, p.get('init.arguments.0'));
    },
  });
  return fns;
}

// ---- pass A: hook providers -------------------------------------------------
const hookProviders = new Map(); // hookName -> Set<endpointName>
for (const f of allSourceFiles()) {
  const { ast } = parseFile(f);
  if (!ast) continue;
  const triggers = mutationBindings(ast);
  const bound = socketBindings(ast);
  const emitted = emittedEvents(ast);
  if (!triggers.size && !bound.size && !emitted.size) continue;
  const fns = fnTable(ast);
  const endpointsOf = name => {
    const out = new Set();
    const walk = (n, depth, seen) => {
      if (depth > 4 || seen.has(n)) return;
      seen.add(n);
      const refs = fns.get(n);
      if (!refs) return;
      for (const e of socketEventsFromRefs(refs, emitted)) out.add(e);
      for (const r of refs) {
        if (triggers.has(r)) out.add(triggers.get(r));
        else if (bound.has(r)) out.add(bound.get(r));
        else if (fns.has(r)) walk(r, depth + 1, seen);
      }
    };
    walk(name, 0, new Set());
    return out;
  };
  for (const name of fns.keys()) {
    if (!/^use[A-Z]/.test(name)) continue;
    const eps = endpointsOf(name);
    if (eps.size) {
      if (!hookProviders.has(name)) hookProviders.set(name, new Set());
      for (const e of eps) hookProviders.get(name).add(e);
    }
  }
}

// ---- pass B: JSX handler props ----------------------------------------------
const dedup = new Map();
const mapping = [];
for (const f of allSourceFiles()) {
  const r = rel(f);
  const { ast } = parseFile(f);
  if (!ast) continue;

  const triggers = mutationBindings(ast); // localName -> endpoint
  const bound = socketBindings(ast); // localName -> 'sio:<event>'
  const emitted = emittedEvents(ast); // events this file literally emits
  // hook-result bindings: localName -> Set<endpoint>
  const hookBound = new Map();
  traverse(ast, {
    VariableDeclarator(p) {
      const init = p.node.init;
      if (!init || init.type !== 'CallExpression' || init.callee.type !== 'Identifier') return;
      const eps = hookProviders.get(init.callee.name);
      if (!eps) return;
      if (p.node.id.type === 'Identifier') hookBound.set(p.node.id.name, eps);
      else if (p.node.id.type === 'ObjectPattern')
        for (const prop of p.node.id.properties)
          if (prop.type === 'ObjectProperty' && prop.value.type === 'Identifier') hookBound.set(prop.value.name, eps);
          else if (prop.type === 'RestElement' && prop.argument.type === 'Identifier') hookBound.set(prop.argument.name, eps);
    },
  });
  if (!triggers.size && !hookBound.size && !bound.size) continue;

  const fns = fnTable(ast);
  const endpointsFromRefs = refs => {
    const out = new Set();
    for (const n of refs) {
      if (triggers.has(n)) out.add(triggers.get(n));
      if (bound.has(n)) out.add(bound.get(n));
      if (hookBound.has(n)) for (const e of hookBound.get(n)) out.add(e);
    }
    for (const e of socketEventsFromRefs(refs, emitted)) out.add(e);
    return out;
  };
  const aliases = refAliases(ast);
  const resolveName = (name, depth, seen) => {
    const out = new Set();
    if (depth > 4 || seen.has(name)) return out;
    seen.add(name);
    if (triggers.has(name)) out.add(triggers.get(name));
    if (bound.has(name)) out.add(bound.get(name));
    if (hookBound.has(name)) for (const e of hookBound.get(name)) out.add(e);
    if (aliases.has(name)) for (const e of resolveName(aliases.get(name), depth + 1, seen)) out.add(e);
    const refs = fns.get(name);
    if (refs) {
      for (const e of socketEventsFromRefs(refs, emitted)) out.add(e);
      for (const rn of refs) for (const e of resolveName(rn, depth + 1, seen)) out.add(e);
    }
    return out;
  };

  traverse(ast, {
    JSXAttribute(p) {
      const attr = p.node.name.name;
      if (typeof attr !== 'string' || !/^on[A-Z]/.test(attr)) return;
      const v = p.node.value;
      if (!v || v.type !== 'JSXExpressionContainer') return;
      const expr = v.expression;
      let hit = new Set();
      if (expr.type === 'Identifier') hit = resolveName(expr.name, 0, new Set());
      else if (expr.type === 'ArrowFunctionExpression' || expr.type === 'FunctionExpression') {
        const refs = new Set();
        p.get('value.expression').traverse({ Identifier(ip) { refs.add(ip.node.name); } });
        hit = endpointsFromRefs(refs);
        for (const n of refs) for (const e of resolveName(n, 1, new Set())) hit.add(e);
      } else if (expr.type === 'CallExpression' && expr.callee.type === 'Identifier') {
        hit = resolveName(expr.callee.name, 0, new Set());
      } else if (expr.type === 'MemberExpression' && expr.object.type === 'Identifier' && hookBound.has(expr.object.name)) {
        hit = new Set(hookBound.get(expr.object.name));
      }
      if (!hit.size) return;
      const { screen, domain } = screenOf(r);
      const site = src(r, p.node.loc.start.line);
      for (const endpointName of hit) {
        let record;
        if (endpointName.startsWith('sio:')) {
          const event = endpointName.slice(4);
          const cat = socketCatalogue.get(event);
          record = {
            endpoint: endpointName, module: 'src/common/constants.js', method: 'SOCKET-EMIT',
            url: event, ambiguous: false,
            defLine: { module: 'src/common/constants.js', line: cat.line },
          };
        } else {
          const defs = endpointByName.get(endpointName);
          if (!defs) continue;
          record = {
            endpoint: endpointName, module: defs[0].module, method: defs[0].method,
            url: defs[0].url, ambiguous: defs.length > 1,
            defLine: { module: defs[0].module, line: defs[0].line },
          };
        }
        mapping.push({ endpoint: endpointName, screen, handlerProp: attr, site });
        const key = `${endpointName}::${screen}`;
        if (!dedup.has(key)) {
          dedup.set(key, { ...record, screen, domain, handlerProps: new Set(), sites: [] });
        }
        const rec = dedup.get(key);
        rec.handlerProps.add(attr);
        if (!rec.sites.includes(site)) rec.sites.push(site);
      }
    },
  });
}

const out = [...dedup.values()]
  .map(x => ({ ...x, handlerProps: [...x.handlerProps].sort(), sites: x.sites.slice(0, 6) }))
  .sort((a, b) => a.screen.localeCompare(b.screen) || a.endpoint.localeCompare(b.endpoint));
console.log(`hook providers: ${hookProviders.size}`);
console.log(`action items (endpoint × screen): ${out.length}; raw handler sites: ${mapping.length}`);
writeOut('actions.json', out);
writeOut('actions-dedup-mapping.json', mapping);
