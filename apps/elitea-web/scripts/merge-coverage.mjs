#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import coveragePkg from 'istanbul-lib-coverage';
import { createContext } from 'istanbul-lib-report';
import reports from 'istanbul-reports';

const { createCoverageMap } = coveragePkg;

const root = process.cwd();
const shardRoot = path.join(root, 'coverage-shards');
const altShardRoot = path.join(root, '..', 'coverage-shards');
const outputDir = path.join(root, 'coverage');

// CLI flags — coverage-merge CI job uses --no-validate to skip threshold checks.
const args = process.argv.slice(2);
const skipValidation = args.includes('--no-validate');

const globalThresholds = {
  lines: 85,
  statements: 85,
  functions: 85,
  branches: 80,
};
const fileThresholdRules = [
  { pattern: 'src/shared/api/**', thresholds: { lines: 95, branches: 90, functions: 95, statements: 95 } },
  { pattern: 'src/shared/config/**', thresholds: { lines: 95, branches: 90, functions: 95, statements: 95 } },
  { pattern: 'src/shared/brand/**', thresholds: { lines: 95, branches: 90, functions: 95, statements: 95 } },
  { pattern: 'src/shared/lib/**', thresholds: { lines: 95, branches: 90, functions: 95, statements: 95 } },
  { pattern: 'src/entities/**', thresholds: { lines: 90, branches: 85, functions: 90, statements: 90 } },
  { pattern: 'src/features/**', thresholds: { lines: 88, branches: 82, functions: 88, statements: 88 } },
  { pattern: 'src/processes/**', thresholds: { lines: 88, branches: 82, functions: 88, statements: 88 } },
  { pattern: 'src/widgets/**', thresholds: { lines: 85, branches: 80, functions: 85, statements: 85 } },
  { pattern: 'src/pages/**', thresholds: { lines: 80, branches: 75, functions: 80, statements: 80 } },
];

async function main() {
  const shardFiles = await findCoverageFiles();
  if (shardFiles.length === 0) {
    console.log('No coverage shard artifacts found; skipping merged coverage generation.');
    return;
  }

  const coverageMap = createCoverageMap({});
  for (const shardFile of shardFiles) {
    const raw = JSON.parse(await fs.readFile(shardFile, 'utf8'));
    coverageMap.merge(raw);
  }

  printUncoveredInfo(coverageMap);

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const context = createContext({ dir: outputDir, coverageMap });

  const reportsToRender = [
    { type: 'json-summary' },
    { type: 'lcovonly', options: { file: 'lcov.info' } },
    { type: 'html' },
    { type: 'text-summary' },
  ];

  for (const reportDef of reportsToRender) {
    const report = reports.create(reportDef.type, reportDef.options || {});
    console.log(`  Writing ${reportDef.type} report to ${reportDef.options?.file ?? 'context.dir'}...`);
    await report.execute(context);
  }
  // Verify report files were actually written
  const files = await fs.readdir(outputDir);
  console.log(`  Report files in ${outputDir}: ${files.join(', ')}`);

  enforceThresholds(coverageMap, skipValidation);
  console.log('Merged coverage reports generated at', outputDir);
}

function printUncoveredLines(uncoveredLines) {
  if (uncoveredLines.length === 0) return;
  console.log('Uncovered lines per file:');
  for (const entry of uncoveredLines) {
    console.log(`  ${entry.file}: ${entry.uncoveredLines.join(', ')} (${entry.missedLines}/${entry.totalLines} lines uncovered)`);
  }
}

function printUncoveredFunctions(uncoveredFunctions) {
  if (uncoveredFunctions.length === 0) return;
  console.log('Uncovered functions per file:');
  for (const entry of uncoveredFunctions) {
    const details = entry.funcs.map((func) => `${func.name} (line ${func.line})`).join(', ');
    console.log(`  ${entry.file}: ${details}`);
  }
}

function printUncoveredInfo(coverageMap) {
  const uncoveredLines = [];
  const uncoveredFunctions = [];

  for (const file of coverageMap.files()) {
    const fileCoverage = coverageMap.fileCoverageFor(file);
    if (!fileCoverage) continue;

    const relativeFile = path.relative(root, file).replace(/\\/g, '/');
    const lines = fileCoverage.getUncoveredLines();
    const lineCoverage = fileCoverage.getLineCoverage();
    const totalLines = Object.keys(lineCoverage || {}).length;
    if (lines && lines.length > 0) {
      uncoveredLines.push({
        file: relativeFile,
        uncoveredLines: lines,
        totalLines,
        missedLines: lines.length,
      });
    }

    const funcs = getUncoveredFunctions(fileCoverage);
    if (funcs.length > 0) {
      uncoveredFunctions.push({ file: relativeFile, funcs });
    }
  }

  if (uncoveredLines.length === 0 && uncoveredFunctions.length === 0) {
    console.log('No uncovered lines or functions detected in merged coverage.');
    return;
  }

  printUncoveredLines(uncoveredLines);
  printUncoveredFunctions(uncoveredFunctions);
}

function getUncoveredFunctions(fileCoverage) {
  const uncovered = [];
  const fnMap = fileCoverage.fnMap || {};
  const hits = fileCoverage.f || {};

  for (const key of Object.keys(fnMap)) {
    const fnMeta = fnMap[key];
    const hitCount = Number(hits[key] || 0);
    if (hitCount === 0) {
      uncovered.push({
        name: fnMeta.name || '<anonymous>',
        line: fnMeta.decl?.start?.line ?? fnMeta.line ?? 'unknown',
      });
    }
  }

  return uncovered;
}

async function findCoverageFiles() {
  const files = [];
  const roots = [root, shardRoot, altShardRoot];

  const scanDirs = [root, path.join(root, '..')];
  for (const scanDir of scanDirs) {
    try {
      const entries = await fs.readdir(scanDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('coverage-shard-')) {
          roots.push(path.join(scanDir, entry.name));
        }
      }
    } catch {
      // ignore missing repo root or permission issues
    }
  }

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile() && entry.name === 'coverage-final.json') {
        files.push(entryPath);
      }
    }
  }

  for (const scanRoot of roots) {
    await walk(scanRoot);
  }

  if (files.length === 0) {
    console.log('No coverage shard artifacts found in:', roots.join(', '));
  }

  return files;
}

function enforceThresholds(coverageMap, skipValidation) {
  if (skipValidation) {
    console.log('Coverage threshold validation skipped (--no-validate).');
    return;
  }
  const summary = getSummary(coverageMap.getCoverageSummary());
  const failures = [];

  checkThreshold('Total coverage', summary, globalThresholds, failures);

  for (const file of coverageMap.files()) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    const rule = fileThresholdRules.find((entry) => matchesPattern(relative, entry.pattern));
    if (!rule) {
      continue;
    }

    const fileCoverage = coverageMap.fileCoverageFor(file);
    const fileSummary = getSummary(fileCoverage.toSummary());
    checkThreshold(relative, fileSummary, rule.thresholds, failures);
  }

  if (failures.length > 0) {
    console.error('Coverage threshold failures:');
    for (const failure of failures) {
      console.error(failure);
    }
    throw new Error('Coverage threshold enforcement failed');
  }
}

function getSummary(summary) {
  if (typeof summary.toJSON === 'function') {
    return summary.toJSON();
  }
  if (summary && typeof summary.data !== 'undefined') {
    return summary.data;
  }
  return summary;
}

function matchesPattern(filePath, pattern) {
  if (pattern.endsWith('/**')) {
    return filePath.startsWith(pattern.slice(0, -3));
  }
  return filePath === pattern;
}

function checkThreshold(name, actual, expected, failures) {
  for (const key of ['lines', 'statements', 'functions', 'branches']) {
    const actualPct = actual[key]?.pct ?? null;
    const requiredPct = expected[key];
    if (requiredPct != null && actualPct != null && actualPct < requiredPct) {
      failures.push(`${name}: ${key} ${actualPct.toFixed(1)}% < ${requiredPct}%`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
