#!/usr/bin/env node
/**
 * spec §7.1 C7b + §9.5 step 9 — the security check that the removed dev-token
 * config keys are absent from the PRODUCTION BUNDLE, not merely from the
 * runtime config object (unit F3).
 *
 * Background (defect D10): the old image emitted `vite_dev_token` and `dev`
 * into a world-readable /app/config.js, and any non-empty DEV attached a
 * static bearer to every API call, socket connection and raw fetch
 * (Containerfile.elitea-ui:55-56; eliteaApi.js:60-63). C7b removes both keys.
 * A runtime unit test can only prove the config OBJECT ignores them; this
 * gate proves the shipped bytes never mention them.
 *
 * The check has two halves, and BOTH must hold:
 *
 *   1. FORBIDDEN — zero occurrences of the dev-token key names or of a
 *      bearer-token literal across dist/**\/*.js and dist/**\/*.html.
 *   2. SENTINELS — the strings that MUST be there (`elitea_ui_config`,
 *      `vite_server_url`, `__ENV__`) are all present. Without this half the
 *      gate would pass vacuously against an empty, stale, or wrongly-globbed
 *      dist/ — a green check that proves nothing is worse than no check.
 *
 * Builds must already exist: this script never builds, so it cannot mask a
 * broken build by rebuilding a clean tree. Run `npm run build` first.
 *
 * Usage: node scripts/check-bundle-secrets.mjs [--root <dir>]
 * Exit codes: 0 clean · 1 violation or missing/absent dist.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCANNED_EXT = /\.(js|html)$/;

/**
 * Case-insensitive so `vite_dev_token` and `VITE_DEV_TOKEN` are one rule, and
 * so a minifier that changes the casing of an object key cannot slip past.
 */
const FORBIDDEN = [
  { pattern: /vite_dev_token/i, label: 'vite_dev_token (C7b / D10 — removed config key)' },
  {
    // `dev` alone is far too common to grep for (every `devDependencies`,
    // `development`, React `__DEV__`…), so the rule targets the shapes the
    // removed key would actually take in a bundle or in config.js.
    pattern: /["'`]dev["'`]\s*:/i,
    label: 'a "dev": config key (C7b / D10 — removed config key)',
  },
  {
    pattern: /bearer\s+[A-Za-z0-9._~+/-]{16,}/i,
    label: 'a hard-coded bearer token literal (§5.4 — credentials never ship in the bundle)',
  },
  {
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
    label: 'a hard-coded JWT literal (§5.4 — credentials never ship in the bundle)',
  },
];

/**
 * Proof-of-reach strings. Each must appear somewhere in the scanned set, or
 * the forbidden half of this gate is not actually reading real bundle content.
 * They are all C5/C6 contract surface, so they cannot legitimately vanish
 * without a contract change that should fail this gate loudly.
 */
const SENTINELS = [
  { pattern: /elitea_ui_config/, label: 'elitea_ui_config (contract C5 runtime config object)' },
  { pattern: /vite_server_url/i, label: 'vite_server_url (contract C7 key)' },
  { pattern: /__ENV__/, label: '__ENV__ (contract C6 source 3)' },
];

function parseArgs(argv) {
  const args = { root: APP_DIR };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      const value = argv[i + 1];
      if (!value) throw new Error('--root requires a directory argument');
      args.root = resolve(value);
      i++;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

function collectBundleFiles(distDir) {
  const files = [];
  for (const file of walk(distDir)) {
    if (SCANNED_EXT.test(file)) {
      files.push(file);
    }
  }
  return files;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/** Scan every bundle file once, collecting both halves of the gate. */
function scan(files, root) {
  const violations = [];
  const seenSentinels = new Set();

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(root, file);

    for (const rule of FORBIDDEN) {
      const match = rule.pattern.exec(text);
      if (match) {
        violations.push(`${rel}:${lineOf(text, match.index)} — found ${rule.label}`);
      }
    }
    for (const sentinel of SENTINELS) {
      if (sentinel.pattern.test(text)) {
        seenSentinels.add(sentinel.label);
      }
    }
  }

  return { violations, missingSentinels: SENTINELS.filter((s) => !seenSentinels.has(s.label)) };
}

/** Resolve the scannable bundle set, or exit(1) with an actionable message. */
function bundleFilesOrExit(distDir, root) {
  let files;
  try {
    files = collectBundleFiles(distDir);
  } catch {
    console.error(
      `check-bundle-secrets: ${relative(root, distDir) || 'dist'}/ does not exist — ` +
        'this gate scans a BUILT bundle and never builds one itself. ' +
        'Run `npm run build` (or build:app/build:admin/build:maintenance) first.',
    );
    process.exit(1);
  }

  if (files.length === 0) {
    console.error(
      `check-bundle-secrets: no .js/.html files under ${relative(root, distDir)}/ — ` +
        'refusing to report a vacuous pass. Run `npm run build` first.',
    );
    process.exit(1);
  }

  return files;
}

function main() {
  const { root } = parseArgs(process.argv.slice(2));
  const distDir = join(root, 'dist');
  const files = bundleFilesOrExit(distDir, root);
  const { violations, missingSentinels } = scan(files, root);

  for (const violation of violations) {
    console.error(`BUNDLE-SECRET ${violation}`);
  }
  for (const sentinel of missingSentinels) {
    console.error(
      `BUNDLE-SENTINEL missing: ${sentinel.label} was not found in any of the ` +
        `${files.length} scanned file(s) — the C7b grep is not reaching real bundle ` +
        'content, so its "no secrets found" result cannot be trusted.',
    );
  }

  if (violations.length > 0 || missingSentinels.length > 0) {
    console.error(
      `check-bundle-secrets: FAIL — ${violations.length} forbidden-string violation(s), ` +
        `${missingSentinels.length} missing sentinel(s) across ${files.length} bundle file(s).`,
    );
    process.exit(1);
  }

  console.log(
    `check-bundle-secrets: OK — ${files.length} bundle file(s) scanned; ` +
      `${FORBIDDEN.length} forbidden pattern(s) absent (C7b/D10), ` +
      `${SENTINELS.length} sentinel(s) present (grep proven to reach bundle content).`,
  );
}

main();
