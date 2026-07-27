// §8.3 step 4 — socket events: one item per event in the sioEvents catalogue
// (channel events) + SocketMessageType (streaming payload discriminants).
// Anchored to their definition lines in constants.js; enriched with emit/on
// call sites found across src.
import path from 'node:path';
import { BASELINE, allSourceFiles, parseFile, rel, src, traverse, writeOut } from './common.mjs';

const CONSTANTS = 'src/common/constants.js';
const { ast } = parseFile(path.join(BASELINE, CONSTANTS));

function collectObject(name) {
  const out = [];
  traverse(ast, {
    VariableDeclarator(p) {
      if (p.node.id.name !== name) return;
      for (const prop of p.node.init.properties) {
        if (prop.type !== 'ObjectProperty' || prop.value.type !== 'StringLiteral') continue;
        out.push({ key: prop.key.name || prop.key.value, value: prop.value.value, line: prop.loc.start.line });
      }
    },
  });
  return out;
}

const events = collectObject('sioEvents');
const discriminants = collectObject('SocketMessageType');

// usage scan: sioEvents.<key> / SocketMessageType.<key> member accesses, and
// direction where the member is the first arg of .emit(...) / .on(...).
const usage = new Map(); // value -> {sites:[], emit:bool, on:bool}
const byKeyE = new Map(events.map(e => [e.key, e]));
const byKeyD = new Map(discriminants.map(e => [e.key, e]));
for (const f of allSourceFiles()) {
  const r = rel(f);
  if (r === CONSTANTS) continue;
  const { ast: a, code } = parseFile(f);
  if (!a) continue;
  traverse(a, {
    MemberExpression(p) {
      const obj = p.node.object.name;
      if (obj !== 'sioEvents' && obj !== 'SocketMessageType') return;
      const key = p.node.property.name;
      const def = obj === 'sioEvents' ? byKeyE.get(key) : byKeyD.get(key);
      if (!def) return;
      const rec = usage.get(def.value) || { sites: [], emit: false, on: false };
      rec.sites.push(src(r, p.node.loc.start.line));
      // direction: sio.emit(sioEvents.x ...) / sio.on(sioEvents.x ...)
      const parent = p.parentPath.node;
      if (parent.type === 'CallExpression' && parent.arguments[0] === p.node) {
        const callee = parent.callee;
        if (callee.type === 'MemberExpression') {
          if (callee.property.name === 'emit') rec.emit = true;
          if (callee.property.name === 'on' || callee.property.name === 'off') rec.on = true;
        }
      }
      usage.set(def.value, rec);
    },
  });
}

const out = [];
for (const e of events) {
  const u = usage.get(e.value) || { sites: [], emit: false, on: false };
  out.push({
    kind: 'event',
    name: e.value,
    line: e.line,
    direction: u.emit && u.on ? 'both' : u.emit ? 'emit' : u.on ? 'receive' : 'catalogued',
    sites: u.sites.slice(0, 4),
  });
}
for (const d of discriminants) {
  const u = usage.get(d.value) || { sites: [] };
  out.push({ kind: 'discriminant', name: d.value, line: d.line, direction: 'receive', sites: u.sites.slice(0, 4) });
}
console.log(`channel events: ${events.length} (spec §5.5 says 43); discriminants: ${discriminants.length} (spec says 34)`);
writeOut('sockets.json', out);
