#!/usr/bin/env node
/**
 * F5 gate — validates parity/wave2-partition.json (spec §9.3).
 *
 * Checks, in order:
 *   1. every Wave-2 unit from spec §9.3 is present (C1–C6, A1–A15, W-shell) and no strays;
 *   2. every unit has ≥1 ownedPath and the ownedPaths of different units have ZERO overlap
 *      (no equal paths, no path that is a prefix-directory of another unit's path);
 *   3. all 13 domains (12 lazy-route domains + shell) are covered by ≥1 existing unit.
 *
 * Dependency-free plain Node. Exit code 0 = partition valid, non-zero = violation.
 * Run from anywhere: paths resolve relative to this script.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const partitionPath = join(here, '..', 'parity', 'wave2-partition.json');

const REQUIRED_UNITS = [
  'C1', 'C2', 'C3', 'C4', 'C5', 'C6',
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10',
  'A11', 'A12', 'A13', 'A14', 'A15',
  'W-shell',
];
const REQUIRED_DOMAINS = [
  'chat', 'settings', 'artifacts', 'misc', 'analytics', 'skills',
  'credentials', 'agents', 'pipelines', 'apps', 'toolkits', 'mcp',
  'shell',
];

const errors = [];
let partition;
try {
  partition = JSON.parse(readFileSync(partitionPath, 'utf8'));
} catch (e) {
  console.error(`FAIL: cannot read ${partitionPath}: ${e.message}`);
  process.exit(1);
}

const units = partition.units ?? {};

// 1. unit presence
for (const id of REQUIRED_UNITS) {
  if (!units[id]) errors.push(`missing Wave-2 unit '${id}' (spec §9.3)`);
}
for (const id of Object.keys(units)) {
  if (!REQUIRED_UNITS.includes(id)) errors.push(`unknown unit '${id}' — not in spec §9.3`);
}

// 2. ownedPaths shape + zero overlap across units
const norm = p => String(p).replace(/\/+$/, '');
const owned = []; // {unit, path}
for (const [id, u] of Object.entries(units)) {
  const paths = Array.isArray(u.ownedPaths) ? u.ownedPaths : [];
  if (paths.length === 0) errors.push(`unit '${id}' has no ownedPaths`);
  const seen = new Set();
  for (const raw of paths) {
    const p = norm(raw);
    if (!p.startsWith('src/')) errors.push(`unit '${id}' ownedPath '${raw}' does not start with 'src/'`);
    if (seen.has(p)) errors.push(`unit '${id}' lists ownedPath '${raw}' twice`);
    seen.add(p);
    owned.push({ unit: id, path: p });
  }
}
for (let i = 0; i < owned.length; i++) {
  for (let j = i + 1; j < owned.length; j++) {
    const a = owned[i], b = owned[j];
    if (a.unit === b.unit) continue;
    if (a.path === b.path || a.path.startsWith(b.path + '/') || b.path.startsWith(a.path + '/')) {
      errors.push(`ownedPaths overlap: ${a.unit}:'${a.path}' vs ${b.unit}:'${b.path}'`);
    }
  }
}

// 3. domain coverage
const domains = partition.domains ?? {};
for (const d of REQUIRED_DOMAINS) {
  const us = domains[d];
  if (!Array.isArray(us) || us.length === 0) {
    errors.push(`domain '${d}' is not covered by any unit`);
    continue;
  }
  for (const u of us) {
    if (!units[u]) errors.push(`domain '${d}' references unit '${u}' which does not exist`);
  }
}
for (const d of Object.keys(domains)) {
  if (!REQUIRED_DOMAINS.includes(d)) errors.push(`unknown domain '${d}' — the route-domain set is fixed by spec §9.1`);
}

if (errors.length) {
  console.error(`FAIL: wave2-partition.json — ${errors.length} violation(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const pathCount = owned.length;
const srcTotal = Object.values(units).reduce((a, u) => a + (u.sourceFileCount ?? 0), 0);
console.log(
  `OK: ${REQUIRED_UNITS.length} Wave-2 units present, ${pathCount} owned paths with zero overlap, ` +
  `${REQUIRED_DOMAINS.length}/13 domains covered (${srcTotal} old-app source-file references).`,
);
