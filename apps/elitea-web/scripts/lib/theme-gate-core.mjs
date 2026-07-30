/**
 * Decision logic for scripts/theme-gate.mjs — spec §4.6 checks 2–6 as pure
 * text/path functions (the §4.6 greps, linter-independent per D2), so they
 * are table-testable without a filesystem. Check 1 (raw colours) runs the
 * elitea/no-raw-color lint rule via oxlint and lives in the CLI; check 7
 * (brand-pack round trip) is unit T1's vitest contract test, invoked by the
 * CLI when the file exists.
 */

/** A file for the text checks: { path, text } with path relative to root. */

const MODE_BRANCH_RE = /palette\.mode\s*===|isDarkMode\s*\?/;
const THEME_PALETTE_RE = /theme\.palette\./;
const MUI_SELECTOR_RE = /\.Mui[A-Za-z]+-|\.css-[a-z0-9]{5,}/;
const FORKED_ASSET_RE = /-(light|dark)\.(svg|png)$/;
const EXTERNAL_ORIGIN_RE = /fonts\.googleapis\.com|fonts\.gstatic\.com|avatars\.githubusercontent\.com/;

/**
 * Strips `/* ... *\/` block comments (including JSDoc), replacing each with
 * an equal-length run of newlines so every remaining line keeps its real
 * line number. Doc comments routinely MENTION a banned pattern to explain
 * why a file avoids it (e.g. "banned by elitea/no-mode-branch") — without
 * this, the checks below flag their own explanatory prose as a violation.
 * Deliberately does NOT touch `//` line comments: check 6 matches literal
 * URLs (`https://fonts.googleapis.com/...`), which contain `//` themselves —
 * stripping from `//` onward would silently blind that check to real
 * violations instead of just ignoring documentation.
 */
function stripBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ''));
}

function grep(files, re, filterFile) {
  const hits = [];
  for (const file of files) {
    if (filterFile && !filterFile(file.path)) continue;
    const lines = stripBlockComments(file.text).split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        hits.push({ path: file.path, line: i + 1, text: file.text.split('\n')[i].trim() });
      }
    }
  }
  return hits;
}

const isTs = (path) => path.endsWith('.ts') || path.endsWith('.tsx');
const isTsx = (path) => path.endsWith('.tsx');

/** §4.6 check 2 — no scheme branches, anywhere in src (no exemptions). */
export function checkModeBranches(files) {
  return grep(files, MODE_BRANCH_RE, isTs);
}

/** §4.6 check 3 — no theme.palette outside shared/brand (tsx, per the spec grep). */
export function checkThemePalette(files) {
  return grep(files, THEME_PALETTE_RE, (path) => isTsx(path) && !path.startsWith('src/shared/brand/'));
}

/** §4.6 check 4 — no MUI internal selectors outside the override package. */
export function checkMuiSelectors(files) {
  return grep(files, MUI_SELECTOR_RE, (path) => isTsx(path) && !path.startsWith('src/shared/brand/mui-overrides/') && !path.startsWith('src/features/chat-messages/'));
}

/** §4.6 check 5 — no forked light/dark assets (R-T8's CI check). */
export function checkForkedAssets(assetPaths) {
  return assetPaths
    .filter((path) => FORKED_ASSET_RE.test(path))
    .map((path) => ({ path, line: 0, text: 'light/dark-forked asset (author once with currentColor, §3.7)' }));
}

/** §4.6 check 6 — no external font/image origins in index.html or src. */
export function checkExternalOrigins(files) {
  return grep(files, EXTERNAL_ORIGIN_RE);
}
