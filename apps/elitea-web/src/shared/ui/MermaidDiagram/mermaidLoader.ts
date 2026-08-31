import DOMPurify from 'dompurify';

/**
 * The `mermaid` package is ~1 MB unminified and pulls its own layout engines
 * (dagre, cytoscape, d3) with it. It must NEVER reach an entry chunk: the app
 * and admin initial bundles both sit under a 300 KB gzip budget
 * (`bundle-budget.json`, `scripts/check-bundle-budget.mjs`) and mermaid alone
 * would blow through it. Hence:
 *
 *  - the ONLY reference to the package in this file is the dynamic
 *    `import('mermaid')` inside `loadMermaid()` — a static
 *    `import … from 'mermaid'` anywhere would fold it into whatever chunk the
 *    importer lands in, and `MermaidDiagram.test.ts`'s lazy-import test asserts
 *    that this file's source contains no such statement;
 *  - `MermaidDiagram` itself is imported normally (it is small); it is the
 *    `loadMermaid()` call inside its effect that pulls the engine, so a screen
 *    that renders no diagram never downloads it.
 *
 * `typeof import('mermaid')` below is a TYPE-position import: TypeScript erases
 * it, so it emits no runtime reference and no chunk edge.
 */
type MermaidApi = (typeof import('mermaid'))['default'];

let modulePromise: Promise<MermaidApi> | null = null;

/**
 * Resolves the mermaid engine, importing it on first call and reusing the same
 * promise afterwards (mermaid keeps global config, so one instance per page is
 * both cheaper and correct).
 */
export function loadMermaid(): Promise<MermaidApi> {
  modulePromise ??= import('mermaid').then((module) => module.default);
  return modulePromise;
}

/**
 * Whether {@link loadMermaid} has been called at least once in this page/test.
 *
 * Exists so the laziness claim is TESTABLE at runtime rather than only by
 * reading the source: importing this module (or `MermaidDiagram`) must leave
 * this `false`. `elitea/no-vi-mock` (R-M1) bans mocking the package to observe
 * the same thing, and a module-graph assertion is exactly the kind of "absence
 * reads as correctness" claim that needs a positive counterpart — so the test
 * asserts both this flag and the absence of a static import.
 */
export function isMermaidEngineLoaded(): boolean {
  return modulePromise !== null;
}

/**
 * Tags that must never survive into the injected SVG. `script` is the obvious
 * one; `foreignObject` is the subtle one — it is the escape hatch back into
 * arbitrary HTML inside an SVG document, and it is exactly what mermaid's
 * `htmlLabels` option emits. `MermaidDiagram` turns `htmlLabels` off for that
 * reason, and this list is the second lock on the same door.
 */
const FORBIDDEN_SVG_TAGS = ['script', 'foreignObject', 'iframe', 'object', 'embed', 'link', 'meta', 'base'] as const;

/**
 * Sanitizes the SVG markup mermaid produces before it is injected into the
 * document.
 *
 * Diagram source arrives from chat content — user- and model-authored — so the
 * rendered output is untrusted even though mermaid produced it. Two layers:
 *
 *  1. `securityLevel: 'strict'` in `MermaidDiagram` (mermaid's own strongest
 *     non-iframe level): HTML in diagram labels is encoded rather than
 *     rendered, and `click`-directive script bindings are refused.
 *  2. this DOMPurify pass, which strips `on*` handlers, `javascript:` URLs and
 *     the tags above from the finished markup. DOMPurify's `svg` profile keeps
 *     the `<style>` block mermaid emits (its CSS is sanitized in place), which
 *     is what carries the diagram's theming.
 *
 * `sanitizeMarkdownHtml` (the sibling helper) cannot be reused here: it FORBIDS
 * `svg` outright, which is the correct call for markdown and the wrong one for
 * a component whose entire output is an SVG.
 */
export function sanitizeDiagramSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: [...FORBIDDEN_SVG_TAGS],
  });
}
