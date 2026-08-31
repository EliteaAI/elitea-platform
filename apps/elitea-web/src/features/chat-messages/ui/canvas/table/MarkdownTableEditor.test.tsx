/**
 * The canvas table editor's contract with `CanvasEditor`: the imperative ref
 * (`addRow`/`addColumn`/`resetTable`/`delete`/`setCode`/`getCode`) and the
 * debounced `onChange` that writes markdown back to the canvas.
 *
 * The round-trip case that matters is a cell containing a `|`: it must
 * survive parse → edit → serialise, through the LIVE component, not just the
 * pure serialiser (`../../../lib/markdownTable.test.ts` pins that half).
 */
import { createRef } from 'react';

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { parseMarkdownTable } from '../../../lib/markdownTable';
import type { MarkdownTableEditorHandle } from './MarkdownTableEditor';
import { MarkdownTableEditor } from './MarkdownTableEditor';

const WITH_PIPE = '| Name | Expression |\n| --- | --- |\n| or | a \\| b |\n| and | c \\| d |\n';

function renderEditor(markdown = WITH_PIPE) {
  const ref = createRef<MarkdownTableEditorHandle>();
  const onChange = vi.fn();
  const onRowsColumnsSelected = vi.fn();
  renderWithTheme(
    <MarkdownTableEditor
      ref={ref}
      content={{ initialMarkdown: markdown, onChange }}
      onRowsColumnsSelected={onRowsColumnsSelected}
    />,
  );
  return { ref, onChange, onRowsColumnsSelected };
}

describe('MarkdownTableEditor', () => {
  it('renders a cell containing a pipe as the pipe, not as an escape', () => {
    renderEditor();
    expect(screen.getByText('a | b')).toBeTruthy();
  });

  it('round-trips the whole table through the live editor without corrupting the piped cell', async () => {
    const { ref, onChange } = renderEditor();

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const emitted = ref.current?.getCode() ?? '';

    expect(parseMarkdownTable(emitted)).toEqual({
      headers: ['Name', 'Expression'],
      rows: [
        ['or', 'a | b'],
        ['and', 'c | d'],
      ],
    });
  });

  it('renames a column header through the header text field and re-serialises it', async () => {
    const { ref } = renderEditor();

    const header = screen.getAllByLabelText('Column header')[0] as HTMLInputElement;
    await userEvent.clear(header);
    await userEvent.type(header, 'Label');

    await waitFor(() => expect(parseMarkdownTable(ref.current?.getCode() ?? '').headers[0]).toBe('Label'));
  });

  it('addRow appends an empty row and addColumn appends an empty column', async () => {
    const { ref } = renderEditor();

    ref.current?.addRow();
    await waitFor(() => expect(parseMarkdownTable(ref.current?.getCode() ?? '').rows).toHaveLength(3));
    expect(parseMarkdownTable(ref.current?.getCode() ?? '').rows[2]).toEqual(['', '']);

    ref.current?.addColumn();
    await waitFor(() => expect(parseMarkdownTable(ref.current?.getCode() ?? '').headers).toHaveLength(3));
    expect(parseMarkdownTable(ref.current?.getCode() ?? '').headers[2]).toBe('Column_3');
  });

  it('resetTable replaces the whole table — the CSV-import and canvas-sync path', async () => {
    const { ref } = renderEditor();

    ref.current?.resetTable({ headers: ['x'], rows: [['1'], ['2']] });

    await waitFor(() =>
      expect(parseMarkdownTable(ref.current?.getCode() ?? '')).toEqual({ headers: ['x'], rows: [['1'], ['2']] }),
    );
  });

  it('setCode replaces the table from raw markdown, escaping intact', async () => {
    const { ref } = renderEditor();

    ref.current?.setCode('| h |\n| --- |\n| p \\| q |\n');

    await waitFor(() => expect(parseMarkdownTable(ref.current?.getCode() ?? '').rows).toEqual([['p | q']]));
  });

  it('undo reverses the last structural edit and redo re-applies it', async () => {
    const { ref } = renderEditor();

    ref.current?.addRow();
    await waitFor(() => expect(parseMarkdownTable(ref.current?.getCode() ?? '').rows).toHaveLength(3));

    ref.current?.undo();
    await waitFor(() => expect(parseMarkdownTable(ref.current?.getCode() ?? '').rows).toHaveLength(2));

    ref.current?.redo();
    await waitFor(() => expect(parseMarkdownTable(ref.current?.getCode() ?? '').rows).toHaveLength(3));
  });

  it('delete() does nothing while nothing is selected — no confirmation dialog appears', async () => {
    renderEditor();

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('selecting a row opens the delete confirmation and dropping it re-serialises without that row', async () => {
    const { ref, onRowsColumnsSelected } = renderEditor();

    // The checkbox column is added by `checkboxSelection`; the first checkbox
    // is the header's "select all".
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[1] as HTMLElement);

    await waitFor(() =>
      expect(onRowsColumnsSelected).toHaveBeenCalledWith(
        expect.objectContaining({ hasSelectedRows: true, hasSelectedColumns: false }),
      ),
    );

    ref.current?.delete();
    const confirm = await screen.findByRole('button', { name: 'Delete' });
    await userEvent.click(confirm);

    await waitFor(() => expect(parseMarkdownTable(ref.current?.getCode() ?? '').rows).toEqual([['and', 'c | d']]));
  });

  it('serialises to the empty string once every column is gone', async () => {
    const { ref } = renderEditor();

    ref.current?.resetTable({ headers: [], rows: [] });

    await waitFor(() => expect(ref.current?.getCode()).toBe(''));
  });
});
