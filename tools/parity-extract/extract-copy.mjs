// §8.3 step 7 — copy: R-T3-style extraction of user-visible strings.
// Granularity (documented choice): ONE visual item PER SOURCE FILE that
// contains user-visible strings — finer than the sanctioned route-level
// batching (so nothing hides inside a big screen), far coarser than
// per-string (which would drown the manifest).
// A string is user-visible when it is (a) JSX text with at least one letter,
// or (b) a string value of a user-facing JSX attribute / object property
// (label, title, placeholder, tooltip, message, ...).
import { allSourceFiles, parseFile, rel, screenOf, src, traverse, writeOut } from './common.mjs';

const VISIBLE_ATTRS = new Set([
  'label', 'title', 'placeholder', 'tooltip', 'tooltipTitle', 'alt', 'ariaLabel', 'aria-label',
  'buttonText', 'text', 'message', 'header', 'description', 'subtitle', 'primaryText',
  'secondaryText', 'emptyText', 'confirmText', 'cancelText', 'okText', 'helperText',
  'warningMessage', 'errorMessage', 'successMessage', 'infoMessage', 'emptyMessage',
  'noOptionsText', 'loadingText', 'searchPlaceholder', 'typeSelectorTitle', 'headerName',
]);

const LETTER = /[A-Za-z]{2,}/;

// strings only exposed to assistive technology — a visual-regression suite
// cannot see them, so files whose strings are ALL aria-only are verified by
// the a11y/storybook suite instead (flag consumed by build-manifest).
const ARIA_ATTRS = new Set(['ariaLabel', 'aria-label', 'alt']);

const files = [];
for (const f of allSourceFiles()) {
  const r = rel(f);
  if (r.startsWith('src/assets') || /\.test\.|__tests__|\.stories\./.test(r)) continue;
  const { ast } = parseFile(f);
  if (!ast) continue;
  const strings = [];
  traverse(ast, {
    JSXText(p) {
      const t = p.node.value.trim();
      if (t && LETTER.test(t)) strings.push({ text: t.replace(/\s+/g, ' ').slice(0, 80), line: p.node.loc.start.line });
    },
    JSXAttribute(p) {
      const name = p.node.name.name;
      if (!VISIBLE_ATTRS.has(name)) return;
      const v = p.node.value;
      if (v && v.type === 'StringLiteral' && LETTER.test(v.value))
        strings.push({ text: v.value.slice(0, 80), line: p.node.loc.start.line, aria: ARIA_ATTRS.has(name) });
    },
    ObjectProperty(p) {
      const key = p.node.key.name || p.node.key.value;
      if (!VISIBLE_ATTRS.has(key)) return;
      if (p.node.value.type === 'StringLiteral' && LETTER.test(p.node.value.value))
        strings.push({ text: p.node.value.value.slice(0, 80), line: p.node.loc.start.line });
    },
    // JSX children rendered from expressions: {'Save'} and {cond ? 'A' : 'B'}
    JSXExpressionContainer(p) {
      if (p.parentPath.node.type !== 'JSXElement' && p.parentPath.node.type !== 'JSXFragment') return;
      const e = p.node.expression;
      const take = n => {
        if (n && n.type === 'StringLiteral' && LETTER.test(n.value))
          strings.push({ text: n.value.slice(0, 80), line: n.loc.start.line });
      };
      take(e);
      if (e.type === 'ConditionalExpression') {
        take(e.consequent);
        take(e.alternate);
      }
      if (e.type === 'LogicalExpression') take(e.right);
    },
  });
  if (!strings.length) continue;
  const { screen, domain } = screenOf(r);
  const lines = strings.map(s => s.line);
  const ariaOnly = strings.every(s => s.aria === true);
  files.push({
    ariaOnly,
    file: r,
    screen,
    domain,
    count: strings.length,
    samples: strings.slice(0, 3).map(s => s.text),
    firstLine: Math.min(...lines),
    lastLine: Math.max(...lines),
    sources: [src(r, Math.min(...lines)), ...(strings.length > 1 ? [src(r, Math.max(...lines))] : [])],
  });
}

files.sort((a, b) => a.file.localeCompare(b.file));
const total = files.reduce((s, f) => s + f.count, 0);
console.log(`files with user-visible copy: ${files.length}; total strings: ${total}`);
writeOut('copy.json', files);
