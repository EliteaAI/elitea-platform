/**
 * jsdom test-environment polyfills for CodeMirror 6 and `ResizeObserver`,
 * scoped to this unit's own tests — deliberately NOT added to the shared
 * `src/test/setup.ts` bootstrap, whose own doc comment scopes it to "the
 * network boundary" (MSW + the socket double) as the ONLY substitutions a
 * test may make. jsdom implements neither of the two real-browser APIs
 * below, and every CodeMirror-backed component in this unit needs both:
 *
 *  - `Range.prototype.getClientRects`/`getBoundingClientRect`: CM6's
 *    `EditorView` measures text layout on every animation frame
 *    (`ViewState.measure` → `DocView.measureTextSize` →
 *    `textRange(...).getClientRects()`). Without this, mounting ANY
 *    CodeMirror instance under jsdom throws asynchronously out of a
 *    `requestAnimationFrame` callback (`TypeError: textRange(...).
 *    getClientRects is not a function`) — an unhandled rejection vitest
 *    reports as a failed run even though the render/assertions inside the
 *    test itself already passed. Confirmed against this exact
 *    `@codemirror/view@6.43.6` with a throwaway spike test before writing
 *    this file. `clientRectsFor` (`@codemirror/view`'s internal helper)
 *    already treats a zero-length result as "can't measure, skip" (`if
 *    (rects.length != 1) return undefined`), so a length-0 stub is the
 *    correct fake, not a workaround that hides a real assertion.
 *  - `ResizeObserver`: `ResizableCodeMirrorEditor` observes its own
 *    container (`new window.ResizeObserver(...)`) to size the editor.
 *    jsdom has no built-in `ResizeObserver` at all; the bare constructor
 *    call throws synchronously on mount.
 *
 * Call `installCodeMirrorTestPolyfills()` once per test file (module scope
 * or inside a `beforeAll`) before rendering anything that mounts a
 * CodeMirror instance — directly (`CodeMirrorEditor`/
 * `ResizableCodeMirrorEditor`) or indirectly (`CommonObjectField`/
 * `CommonArrayField`/`AnyOfPatternField`/`CommonStringField`'s
 * `codeLanguage` branch, all of which render one).
 */

// Untyped on purpose: real `DOMRectList`/`DOMRect` declare members this fake
// never needs (`clientRectsFor`'s only real read is `.length`, see the file
// doc comment) — inference already lines these up with
// `Range.prototype.getClientRects`/`getBoundingClientRect`'s own signatures
// at the assignment sites below, so no cast is needed (or allowed —
// tsgolint's `no-unnecessary-type-assertion` fires on one that isn't).
function emptyDomRectList() {
  return { length: 0, item: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() };
}

function zeroDomRect() {
  return { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) };
}

class NoopResizeObserver implements ResizeObserver {
  observe(): void {
    /* no-op: jsdom never fires layout, so there is nothing to observe */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
}

export function installCodeMirrorTestPolyfills(): void {
  if (typeof Range.prototype.getClientRects !== 'function') {
    Range.prototype.getClientRects = emptyDomRectList;
  }
  if (typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = zeroDomRect;
  }
  if (typeof window.ResizeObserver === 'undefined') {
    window.ResizeObserver = NoopResizeObserver;
  }
}
