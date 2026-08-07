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
import { afterEach, beforeEach } from 'vitest';

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

/**
 * Inverse of the `ResizeObserver` branch above, for the handful of tests
 * (`EditorPanel.test.tsx`, `PipelineEditor.test.tsx`) that assert on the flow
 * pane's error boundary catching `useFlowEditorResizeObserver`'s real,
 * currently-true failure when `ResizeObserver` is unavailable.
 *
 * jsdom globals are NOT reset between test files within the same vitest
 * worker (proven: the storage shim in `src/test/setup.ts` exists for the
 * identical reason). 28 other test files call
 * `installCodeMirrorTestPolyfills()` above, which defines
 * `window.ResizeObserver` PERMANENTLY for the rest of that worker process's
 * lifetime — so whether the flow-pane fallback tests pass or fail was
 * silently dependent on vitest's file-to-worker scheduling for that run,
 * reproduced directly: 3 consecutive full-suite runs went 2 fail / 0 fail /
 * 0 fail with no source change between them.
 *
 * Call once at module scope in any file with that assertion. Registers its
 * own `beforeEach`/`afterEach` so the precondition holds regardless of
 * which other files already ran in the same worker, and restores whatever
 * was there before so this file does not itself become a new source of the
 * same leak for files that run after it.
 */
export function forceResizeObserverAbsentForTest(): void {
  let previous: typeof window.ResizeObserver;
  let hadOwnProperty = false;

  beforeEach(() => {
    hadOwnProperty = Object.prototype.hasOwnProperty.call(window, 'ResizeObserver');
    previous = window.ResizeObserver;
    // @ts-expect-error -- deliberately removing the global for this test; see the module doc comment above.
    delete window.ResizeObserver;
  });

  afterEach(() => {
    if (hadOwnProperty) {
      window.ResizeObserver = previous;
    } else {
      // @ts-expect-error -- restoring the pre-test "absent" state exactly.
      delete window.ResizeObserver;
    }
  });
}
