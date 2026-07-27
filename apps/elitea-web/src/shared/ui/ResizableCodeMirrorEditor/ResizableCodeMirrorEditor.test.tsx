import { act, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { installCodeMirrorTestPolyfills } from '../lib/field/codeMirrorTestPolyfills';
import { ResizableCodeMirrorEditor } from '.';

installCodeMirrorTestPolyfills();

/** The box editor is always the first `.cm-content` in the tree; the fullscreen modal (when open) renders a second one. */
function getBoxContent(container: HTMLElement): HTMLElement {
  const content = container.querySelector('.cm-content');
  if (!(content instanceof HTMLElement)) throw new Error('CodeMirror content element not found');
  return content;
}

/** A controllable `ResizeObserver` fake for the resize-behaviour tests below — see the first test's comment for why a global spy is not enough. */
class TrackingResizeObserver {
  target: Element | undefined;
  disconnected = false;
  #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }

  observe(target: Element): void {
    this.target = target;
  }

  unobserve(): void {
    /* not used by the component under test */
  }

  disconnect(): void {
    this.disconnected = true;
  }

  /** Invokes this instance's registered callback with one synthetic entry reporting `height`. */
  trigger(height: number): void {
    this.#callback([{ contentRect: { height } } as ResizeObserverEntry], this);
  }
}

function makeTrackingResizeObserverClass(instances: TrackingResizeObserver[]): typeof ResizeObserver {
  return class extends TrackingResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      super(callback);
      instances.push(this);
    }
  };
}

describe('ResizableCodeMirrorEditor', () => {
  it('renders the initial value', () => {
    const { container } = renderWithTheme(<ResizableCodeMirrorEditor value="hello" />);
    expect(getBoxContent(container)).toHaveTextContent('hello');
  });

  it('does not call onChange while typing (commit is on blur, not per keystroke)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderWithTheme(<ResizableCodeMirrorEditor value="abc" onChange={onChange} />);
    const content = getBoxContent(container);
    await user.click(content);
    await user.keyboard('X');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(content).toHaveTextContent('Xabc');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('calls onChange with the edited value on blur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderWithTheme(<ResizableCodeMirrorEditor value="abc" onChange={onChange} />);
    const content = getBoxContent(container);
    await user.click(content);
    await user.keyboard('X');
    content.blur();
    expect(onChange).toHaveBeenCalledWith('Xabc');
  });

  it('does not call onChange on blur when readOnly', () => {
    const onChange = vi.fn();
    const { container } = renderWithTheme(
      <ResizableCodeMirrorEditor
        value="abc"
        onChange={onChange}
        readOnly
      />,
    );
    const content = getBoxContent(container);
    content.focus();
    content.blur();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('follows an external value change', () => {
    const { container, rerender } = renderWithTheme(<ResizableCodeMirrorEditor value="first" />);
    expect(getBoxContent(container)).toHaveTextContent('first');
    rerender(<ResizableCodeMirrorEditor value="second" />);
    expect(getBoxContent(container)).toHaveTextContent('second');
  });

  it('does not render an expand button when expandAction is left at its default (false)', () => {
    const { queryByRole } = renderWithTheme(<ResizableCodeMirrorEditor value="abc" />);
    expect(queryByRole('button')).not.toBeInTheDocument();
  });

  describe('expandAction', () => {
    it('renders a labelled expand button', () => {
      const { getByRole } = renderWithTheme(
        <ResizableCodeMirrorEditor
          value="abc"
          expandAction
          fieldName="My field"
        />,
      );
      expect(getByRole('button', { name: 'Full screen view' })).toBeInTheDocument();
    });

    it('opens a fullscreen modal with the current value on click', async () => {
      const user = userEvent.setup();
      const { getByRole, getAllByText } = renderWithTheme(
        <ResizableCodeMirrorEditor
          value="abc"
          expandAction
          fieldName="My field"
        />,
      );
      await user.click(getByRole('button', { name: 'Full screen view' }));
      expect(getByRole('dialog')).toBeInTheDocument();
      // The title (`fieldName`) and the value both appear once the modal renders.
      expect(getAllByText('My field').length).toBeGreaterThan(0);
    });

    it('commits an edit made in the fullscreen editor immediately (not on blur)', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { getByRole } = renderWithTheme(
        <ResizableCodeMirrorEditor
          value="abc"
          onChange={onChange}
          expandAction
          fieldName="My field"
        />,
      );
      await user.click(getByRole('button', { name: 'Full screen view' }));
      // MUI's `Dialog` renders through a portal appended to `document.body`,
      // outside the `render()` container — the fullscreen editor has to be
      // found there, not under `container`.
      const editors = document.body.querySelectorAll('.cm-content');
      const fullscreenEditor = editors[1];
      if (!(fullscreenEditor instanceof HTMLElement)) throw new Error('fullscreen editor not found');
      await user.click(fullscreenEditor);
      await user.keyboard('X');
      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith('Xabc');
      });
    });

    it('closes the fullscreen modal', async () => {
      const user = userEvent.setup();
      const { getByRole, queryByRole } = renderWithTheme(
        <ResizableCodeMirrorEditor
          value="abc"
          expandAction
          fieldName="My field"
        />,
      );
      await user.click(getByRole('button', { name: 'Full screen view' }));
      expect(getByRole('dialog')).toBeInTheDocument();
      await user.click(getByRole('button', { name: 'Close' }));
      // MUI's `Dialog` keeps the surface mounted for its exit transition —
      // an immediate `queryByRole` still finds it mid-animation, so this
      // waits the closed state out instead of asserting synchronously.
      await waitForElementToBeRemoved(() => queryByRole('dialog'));
    });
  });

  describe('resize behaviour (ResizeObserver -> editor height)', () => {
    it('sizes the box editor from the container height reported by ResizeObserver', () => {
      // CM6's own `EditorView` also uses a `ResizeObserver` internally (to
      // detect its own size changes), so a *global* spy would double-count.
      // This fake tracks one instance per `new ResizeObserver(...)` call and
      // records which DOM node each one observed, so the assertions below
      // can target the specific instance `ResizableCodeMirrorEditor` itself
      // created (identified by the box's `data-testid`), not just "some
      // observer, possibly CM6's own, did something".
      const instances: TrackingResizeObserver[] = [];
      const originalResizeObserver = window.ResizeObserver;
      window.ResizeObserver = makeTrackingResizeObserverClass(instances);

      try {
        const { container } = renderWithTheme(<ResizableCodeMirrorEditor value="abc" />);
        const box = container.querySelector('[data-testid="resizable-code-mirror-editor-box"]');
        const boxObserver = instances.find((instance) => instance.target === box);
        expect(boxObserver).toBeDefined();

        // The `ResizeObserver` callback fires outside any React event
        // handler, so the `setEditorHeight` state update it triggers is not
        // automatically batched/flushed the way a simulated user
        // interaction's would be — `act` flushes it synchronously here,
        // matching what a real `ResizeObserver` notification would do via
        // the browser's own event loop.
        act(() => {
          boxObserver?.trigger(456);
        });

        const editor = container.querySelector('.cm-editor');
        expect(editor).toHaveStyle({ height: '456px' });
      } finally {
        window.ResizeObserver = originalResizeObserver;
      }
    });

    it('disconnects only its own observer on unmount, leaving no dangling instance', () => {
      const instances: TrackingResizeObserver[] = [];
      const originalResizeObserver = window.ResizeObserver;
      window.ResizeObserver = makeTrackingResizeObserverClass(instances);

      try {
        const { container, unmount } = renderWithTheme(<ResizableCodeMirrorEditor value="abc" />);
        const box = container.querySelector('[data-testid="resizable-code-mirror-editor-box"]');
        const boxObserver = instances.find((instance) => instance.target === box);
        expect(boxObserver?.disconnected).toBe(false);

        unmount();

        expect(boxObserver?.disconnected).toBe(true);
      } finally {
        window.ResizeObserver = originalResizeObserver;
      }
    });
  });
});
