import { fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { installCodeMirrorTestPolyfills } from '@/shared/ui/lib/field/codeMirrorTestPolyfills';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { OpenAPISchemaInput } from './OpenAPISchemaInput';

installCodeMirrorTestPolyfills();

const VALID_SCHEMA = JSON.stringify({ paths: { '/users': { get: {} } } });

function makeFile(name: string, content: string, type = 'text/plain'): File {
  return new File([content], name, { type });
}

/** The editor's own `.cm-content` is the real `role="textbox"` element — mirrors `CodeMirrorEditor.test.tsx`'s own helper. */
function getCodeMirrorContent(container: HTMLElement): HTMLElement {
  const content = container.querySelector('.cm-content');
  if (!(content instanceof HTMLElement)) throw new Error('CodeMirror content element not found');
  return content;
}

/** The drop/drag-over target is the editor's wrapper `Box`, the parent of `.cm-content` — mirrors `FileReaderInput.test.tsx`'s dropzone-lookup pattern. */
function getDropzone(container: HTMLElement): HTMLElement {
  const content = container.querySelector('.cm-content');
  const dropzone = content?.closest('.cm-editor')?.parentElement;
  if (!(dropzone instanceof HTMLElement)) throw new Error('Dropzone element not found');
  return dropzone;
}

describe('OpenAPISchemaInput', () => {
  it('renders the "Schema" accordion title', () => {
    const { getByText } = renderWithTheme(
      <OpenAPISchemaInput
        value={undefined}
        onValueChange={vi.fn()}
        setToolErrors={vi.fn()}
      />,
    );
    expect(getByText('Schema')).toBeInTheDocument();
  });

  it('shows the placeholder + choose-file link when there is no value, once expanded', () => {
    const { getByText } = renderWithTheme(
      <OpenAPISchemaInput
        value={undefined}
        onValueChange={vi.fn()}
        setToolErrors={vi.fn()}
      />,
    );
    fireEvent.click(getByText('Schema'));
    expect(getByText('choose file')).toBeInTheDocument();
  });

  it('shows the helperText when error is true', () => {
    const { getByText } = renderWithTheme(
      <OpenAPISchemaInput
        value={VALID_SCHEMA}
        onValueChange={vi.fn()}
        setToolErrors={vi.fn()}
        error
        helperText="Invalid schema"
      />,
    );
    fireEvent.click(getByText('Schema'));
    expect(getByText('Invalid schema')).toBeInTheDocument();
  });

  it('hides the helperText when error is false, even if helperText is supplied', () => {
    const { getByText, queryByText } = renderWithTheme(
      <OpenAPISchemaInput
        value={VALID_SCHEMA}
        onValueChange={vi.fn()}
        setToolErrors={vi.fn()}
        helperText="Invalid schema"
      />,
    );
    fireEvent.click(getByText('Schema'));
    expect(queryByText('Invalid schema')).not.toBeInTheDocument();
  });

  it('opens the full-screen modal when the full-screen button is clicked', () => {
    const { getByText, getByRole } = renderWithTheme(
      <OpenAPISchemaInput
        value={VALID_SCHEMA}
        onValueChange={vi.fn()}
        setToolErrors={vi.fn()}
      />,
    );
    fireEvent.click(getByText('Schema'));
    // No `{ hidden: true }` escape hatch. The full-screen button's wrapper
    // used to be `display: 'none'` until a mouse hover, which removed the
    // button from the accessibility tree and the tab order: a keyboard-only
    // or touch user could never reach the full-screen editor, and
    // `:focus-within` could never fire because there was nothing to focus.
    // The wrapper is now `opacity: 0` instead, so the control is present and
    // reachable; a plain `getByRole` finding it is the regression guard.
    fireEvent.click(getByRole('button', { name: 'Full screen view' }));
    expect(getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the full-screen toggle out of sight until the editor is hovered or focused', () => {
    const { getByText, getByRole, container } = renderWithTheme(
      <OpenAPISchemaInput
        value={VALID_SCHEMA}
        onValueChange={vi.fn()}
        setToolErrors={vi.fn()}
      />,
    );
    fireEvent.click(getByText('Schema'));
    // The visual affordance is preserved: hidden by opacity, revealed by the
    // wrapper's `:hover`/`:focus-within` rule. Pinned so a later change
    // cannot go back to `display: none`, which is what removed the control
    // from the accessibility tree.
    const wrapper = container.querySelector('[data-fullscreen-toggle]');
    expect(wrapper).not.toBeNull();
    expect(getComputedStyle(wrapper as Element).opacity).toBe('0');
    expect(getByRole('button', { name: 'Full screen view' })).toBeInTheDocument();
  });

  it('parses a valid schema typed into the editor and reports actions + description via onValueChange', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const setToolErrors = vi.fn();
    const { getByText, container } = renderWithTheme(
      <OpenAPISchemaInput
        value=""
        onValueChange={onValueChange}
        setToolErrors={setToolErrors}
      />,
    );
    fireEvent.click(getByText('Schema'));
    const content = getCodeMirrorContent(container);
    await user.click(content);
    // A single `paste` (not per-keystroke `type`) — CM6's `closeBrackets`
    // extension auto-inserts a matching `}`/`"` per keystroke, which
    // corrupts a character-by-character JSON retype (same fix applied in
    // `pages/toolkits/EditToolkit.test.tsx`).
    await user.paste('{"paths":{"/x":{"get":{}}},"description":"desc"}');
    await waitFor(() => {
      expect(onValueChange).toHaveBeenCalled();
    });
    const lastCall = onValueChange.mock.calls.at(-1) as [string, readonly { name: string; path: string; method: string }[], string];
    expect(lastCall[1]).toEqual([expect.objectContaining({ path: '/x', method: 'get' })]);
    expect(lastCall[2]).toBe('desc');
  });

  it('reads the description from info.description when a top-level description is absent', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { getByText, container } = renderWithTheme(
      <OpenAPISchemaInput
        value=""
        onValueChange={onValueChange}
        setToolErrors={vi.fn()}
      />,
    );
    fireEvent.click(getByText('Schema'));
    const content = getCodeMirrorContent(container);
    await user.click(content);
    await user.paste('{"paths":{},"info":{"description":"info-desc"}}');
    await waitFor(() => {
      expect(onValueChange).toHaveBeenCalled();
    });
    const lastCall = onValueChange.mock.calls.at(-1) as [string, unknown, string];
    expect(lastCall[2]).toBe('info-desc');
  });

  it('marks openApiSchema as errored (without invoking onInvalidSchema) when typed JSON parses but has no "paths"', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const setToolErrors = vi.fn();
    const onInvalidSchema = vi.fn();
    const { getByText, container } = renderWithTheme(
      <OpenAPISchemaInput
        value=""
        onValueChange={onValueChange}
        setToolErrors={setToolErrors}
        onInvalidSchema={onInvalidSchema}
      />,
    );
    fireEvent.click(getByText('Schema'));
    const content = getCodeMirrorContent(container);
    await user.click(content);
    await user.paste('{"notPaths":true}');
    await waitFor(() => {
      expect(onValueChange).toHaveBeenCalled();
    });
    const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
    expect(updater({})).toEqual({ openApiSchema: true });
    // Typed edits use `showError=false` — `onInvalidSchema` is reserved for the file-load path.
    expect(onInvalidSchema).not.toHaveBeenCalled();
    const lastCall = onValueChange.mock.calls.at(-1) as [string, readonly unknown[], string];
    expect(lastCall[1]).toEqual([]);
  });

  it('marks openApiSchema as errored when the typed text is neither valid JSON nor valid YAML', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const setToolErrors = vi.fn();
    const { getByText, container } = renderWithTheme(
      <OpenAPISchemaInput
        value=""
        onValueChange={onValueChange}
        setToolErrors={setToolErrors}
      />,
    );
    fireEvent.click(getByText('Schema'));
    const content = getCodeMirrorContent(container);
    await user.click(content);
    // Unclosed flow-sequence: invalid YAML (and invalid JSON).
    await user.paste('a: [1, 2');
    await waitFor(() => {
      expect(onValueChange).toHaveBeenCalled();
    });
    const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
    expect(updater({})).toEqual({ openApiSchema: true });
  });

  it('clears a previously-set openApiSchema error once a valid schema is typed', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const setToolErrors = vi.fn();
    const { getByText, container } = renderWithTheme(
      <OpenAPISchemaInput
        value=""
        onValueChange={onValueChange}
        setToolErrors={setToolErrors}
      />,
    );
    fireEvent.click(getByText('Schema'));
    const content = getCodeMirrorContent(container);
    await user.click(content);
    await user.paste('{"paths":{}}');
    await waitFor(() => {
      expect(onValueChange).toHaveBeenCalled();
    });
    const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
    // Given a prior error, the updater must flip it off.
    expect(updater({ openApiSchema: true })).toEqual({ openApiSchema: false });
    // Given no prior error, the updater must return the very same object (no-op branch).
    const prev = {};
    expect(updater(prev)).toBe(prev);
  });

  it('reads a dropped valid-JSON file and reports the pretty-printed schema + parsed actions', async () => {
    const onValueChange = vi.fn();
    const { getByText, container } = renderWithTheme(
      <OpenAPISchemaInput
        value=""
        onValueChange={onValueChange}
        setToolErrors={vi.fn()}
      />,
    );
    fireEvent.click(getByText('Schema'));
    const dropzone = getDropzone(container);
    const file = makeFile('spec.json', VALID_SCHEMA, 'application/json');
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(onValueChange).toHaveBeenCalled();
    });
    const [schemaString, parsedActions] = onValueChange.mock.calls.at(-1) as [string, readonly { path: string; method: string }[], string];
    expect(schemaString).toBe(JSON.stringify(JSON.parse(VALID_SCHEMA), null, 2));
    expect(parsedActions).toEqual([expect.objectContaining({ path: '/users', method: 'get' })]);
  });

  it('reads a dropped YAML file (JSON.parse fails, YAML load succeeds)', async () => {
    const onValueChange = vi.fn();
    const { getByText, container } = renderWithTheme(
      <OpenAPISchemaInput
        value=""
        onValueChange={onValueChange}
        setToolErrors={vi.fn()}
      />,
    );
    fireEvent.click(getByText('Schema'));
    const dropzone = getDropzone(container);
    const file = makeFile('spec.yaml', 'paths:\n  /pets:\n    get: {}\n', 'application/x-yaml');
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(onValueChange).toHaveBeenCalled();
    });
    const [, parsedActions] = onValueChange.mock.calls.at(-1) as [string, readonly { path: string; method: string }[], string];
    expect(parsedActions).toEqual([expect.objectContaining({ path: '/pets', method: 'get' })]);
  });

  it('invokes onInvalidSchema and marks the error when a dropped file is unparsable as either JSON or YAML', async () => {
    const onValueChange = vi.fn();
    const setToolErrors = vi.fn();
    const onInvalidSchema = vi.fn();
    const { getByText, container } = renderWithTheme(
      <OpenAPISchemaInput
        value=""
        onValueChange={onValueChange}
        setToolErrors={setToolErrors}
        onInvalidSchema={onInvalidSchema}
      />,
    );
    fireEvent.click(getByText('Schema'));
    const dropzone = getDropzone(container);
    const file = makeFile('bad.yaml', 'a: [1, 2\n');
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(onInvalidSchema).toHaveBeenCalledTimes(1);
    });
    const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
    expect(updater({})).toEqual({ openApiSchema: true });
    // The value still changes (to empty, since `fileData` stayed the `''` initializer) even on an unparsable drop.
    expect(onValueChange).toHaveBeenCalledWith('', [], '');
  });

  it('invokes onInvalidSchema when a dropped file parses but has no "paths"', async () => {
    const onInvalidSchema = vi.fn();
    const setToolErrors = vi.fn();
    const { getByText, container } = renderWithTheme(
      <OpenAPISchemaInput
        value=""
        onValueChange={vi.fn()}
        setToolErrors={setToolErrors}
        onInvalidSchema={onInvalidSchema}
      />,
    );
    fireEvent.click(getByText('Schema'));
    const dropzone = getDropzone(container);
    const file = makeFile('spec.json', JSON.stringify({ notPaths: true }));
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(onInvalidSchema).toHaveBeenCalledTimes(1);
    });
    const updater = setToolErrors.mock.calls.at(-1)?.[0] as (prev: Record<string, boolean>) => Record<string, boolean>;
    expect(updater({})).toEqual({ openApiSchema: true });
  });

  it('does nothing when a drop event carries no files', () => {
    const onValueChange = vi.fn();
    const { getByText, container } = renderWithTheme(
      <OpenAPISchemaInput
        value=""
        onValueChange={onValueChange}
        setToolErrors={vi.fn()}
      />,
    );
    fireEvent.click(getByText('Schema'));
    const dropzone = getDropzone(container);
    fireEvent.drop(dropzone, { dataTransfer: { files: [] } });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('does nothing when the native file picker is invoked with no file chosen', () => {
    // `onClickChooseFile` builds a detached `<input type="file">`, wires an `onchange`
    // handler through `handleFile(false)`, and clicks it — there is no file input in the
    // rendered tree to query, so this exercises the "choose file" affordance itself and
    // confirms it does not throw when `document.createElement('input').click()` is invoked
    // in jsdom (which fires no native file-picker and thus no change event).
    const onValueChange = vi.fn();
    const { getByText } = renderWithTheme(
      <OpenAPISchemaInput
        value={undefined}
        onValueChange={onValueChange}
        setToolErrors={vi.fn()}
      />,
    );
    fireEvent.click(getByText('Schema'));
    expect(() => fireEvent.click(getByText('choose file'))).not.toThrow();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('opens and closes the full-screen modal, and edits made there are also propagated', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { getByText, getByRole, queryByRole } = renderWithTheme(
      <OpenAPISchemaInput
        value={VALID_SCHEMA}
        onValueChange={onValueChange}
        setToolErrors={vi.fn()}
      />,
    );
    fireEvent.click(getByText('Schema'));
    fireEvent.click(getByRole('button', { name: 'Full screen view', hidden: true }));
    const dialog = getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    const contents = dialog.querySelectorAll('.cm-content');
    const fullScreenContent = contents[contents.length - 1] as HTMLElement;
    await user.click(fullScreenContent);
    await user.keyboard('X');
    await waitFor(() => {
      expect(onValueChange).toHaveBeenCalled();
    });

    const closeButton = dialog.querySelector('button');
    if (closeButton) fireEvent.click(closeButton);
    await waitFor(() => {
      expect(queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('drag-over then drag-leave toggles the drag-over indicator without leaving a dangling handler', () => {
    const { getByText, container } = renderWithTheme(
      <OpenAPISchemaInput
        value={VALID_SCHEMA}
        onValueChange={vi.fn()}
        setToolErrors={vi.fn()}
      />,
    );
    fireEvent.click(getByText('Schema'));
    const dropzone = getDropzone(container);
    expect(() => {
      fireEvent.dragOver(dropzone, { dataTransfer: { files: [] } });
      fireEvent.dragLeave(dropzone, { dataTransfer: { files: [] } });
    }).not.toThrow();
  });
});
