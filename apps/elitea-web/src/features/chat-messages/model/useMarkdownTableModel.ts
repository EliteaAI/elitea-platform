/**
 * model/useMarkdownTableModel.ts — the state machine behind the canvas
 * markdown-table editor (Canvas slice 3): columns, rows, the undo/redo
 * history, and the row/column selection the header's delete button reads.
 *
 * Split out of the baseline's single 859-line
 * `apps/elitea-ui/src/components/MarkdownTableEditor.jsx` so that neither
 * half breaches the §3.5 400-line file budget. This file is the baseline's
 * `useState`/`useCallback` block plus its `useImperativeHandle` body; the
 * DataGrid markup is `../ui/canvas/table/MarkdownTableEditor.tsx` and the
 * cell/header renderers are its sibling `markdownTableCells.tsx`.
 *
 * The column `field` is an opaque `col_<n>`, never the header text — see
 * `../lib/markdownTable.ts`'s deviation 1 for why (duplicate headers, and a
 * column literally named `id`, both corrupt a header-keyed row object).
 */
import { useCallback, useMemo, useRef, useState } from 'react';

import type { MarkdownTableData } from '../lib/markdownTable';
import { serialiseMarkdownTable } from '../lib/markdownTable';

/** One grid column: an opaque stable id plus the header text the markdown carries. */
interface MarkdownTableColumn {
  readonly field: string;
  readonly headerName: string;
}

/** One grid row: the DataGrid row id plus one string per column `field`. */
export type MarkdownTableRow = { readonly id: number } & Record<string, string | number>;

/** A point in the undo history. */
interface TableSnapshot {
  readonly columns: readonly MarkdownTableColumn[];
  readonly rows: readonly MarkdownTableRow[];
}

/** Which cell/column the caret is in — drives "insert AFTER this one". */
interface MarkdownTableSelectedCell {
  readonly rowId?: number | undefined;
  readonly columnField?: string | undefined;
}

/** What the canvas header needs to enable/disable its delete button. */
export interface MarkdownTableSelection {
  readonly hasSelectedRows: boolean;
  readonly hasSelectedColumns: boolean;
}

let fieldCounter = 0;
/** Column ids must stay unique across resets, or a re-added column inherits the old one's values. */
function nextField(): string {
  fieldCounter += 1;
  return `col_${fieldCounter}`;
}

/** Builds the grid's own column/row state from parsed markdown (or an import). */
function snapshotFromTableData({ headers, rows }: MarkdownTableData): TableSnapshot {
  const columns = headers.map((headerName) => ({ field: nextField(), headerName }));
  const gridRows = rows.map((cells, index) => {
    const row: Record<string, string | number> = { id: index + 1 };
    columns.forEach((column, columnIndex) => {
      row[column.field] = cells[columnIndex] ?? '';
    });
    return row as MarkdownTableRow;
  });
  return { columns, rows: gridRows };
}

/** The inverse: grid state back to the `{ headers, rows }` the serialiser takes. */
function tableDataFromSnapshot(snapshot: TableSnapshot): MarkdownTableData {
  return {
    headers: snapshot.columns.map((column) => column.headerName),
    rows: snapshot.rows.map((row) => snapshot.columns.map((column) => String(row[column.field] ?? ''))),
  };
}

export interface UseMarkdownTableModelParams {
  readonly initialMarkdownData: MarkdownTableData;
  readonly onCanUndo?: ((canUndo: boolean) => void) | undefined;
  readonly onCanRedo?: ((canRedo: boolean) => void) | undefined;
}

export interface UseMarkdownTableModelResult {
  readonly columns: readonly MarkdownTableColumn[];
  readonly rows: readonly MarkdownTableRow[];
  readonly selectedCell: MarkdownTableSelectedCell | null;
  readonly setSelectedCell: (cell: MarkdownTableSelectedCell | null) => void;
  readonly selectedColumns: readonly string[];
  readonly toggleColumnSelection: (field: string) => void;
  readonly selectedRowIds: readonly number[];
  readonly setSelectedRowIds: (ids: readonly number[]) => void;
  readonly selection: MarkdownTableSelection;
  /** Commits one edited cell. */
  readonly updateRow: (row: MarkdownTableRow) => void;
  /** Renames one column's header text. */
  readonly renameColumn: (field: string, headerName: string) => void;
  /** Replaces the row order (the header's client-side sort). */
  readonly reorderRows: (rows: readonly MarkdownTableRow[]) => void;
  readonly addRow: () => void;
  readonly addColumn: () => void;
  /** Drops the selected rows, or the selected columns when no row is selected. */
  readonly deleteSelection: () => void;
  /** Replaces the whole table — canvas sync, and CSV/TSV import. */
  readonly resetTable: (data: MarkdownTableData) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** The current table as markdown. */
  readonly getCode: () => string;
}

/* eslint-disable-next-line complexity -- one cohesive state machine; each closure below is trivial. */
export function useMarkdownTableModel({
  initialMarkdownData,
  onCanUndo,
  onCanRedo,
}: UseMarkdownTableModelParams): UseMarkdownTableModelResult {
  const initial = useRef<TableSnapshot | null>(null);
  initial.current ??= snapshotFromTableData(initialMarkdownData);

  const [snapshot, setSnapshot] = useState<TableSnapshot>(initial.current);
  const [history, setHistory] = useState<readonly TableSnapshot[]>([initial.current]);
  const [historyIndex, setHistoryIndex] = useState(0);
  // The authoritative index, moved SYNCHRONOUSLY by every history transition.
  // `historyIndex` alone cannot serve: `commit` truncates the redo tail
  // relative to the current index, and two commits dispatched in one React
  // batch both read the pre-batch value from their render closure, so the
  // second slices away the entry the first appended and undo skips the
  // intermediate state. Every write goes through `moveHistoryIndex`.
  const historyIndexRef = useRef(0);
  const moveHistoryIndex = useCallback((index: number) => {
    historyIndexRef.current = index;
    setHistoryIndex(index);
  }, []);

  const [selectedCell, setSelectedCell] = useState<MarkdownTableSelectedCell | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<readonly string[]>([]);
  const [selectedRowIds, setSelectedRowIds] = useState<readonly number[]>([]);

  /** Pushes a new state, truncating any redo tail — the baseline's `saveToHistory`. */
  const commit = useCallback(
    (next: TableSnapshot) => {
      setSnapshot(next);
      // Computed OUTSIDE the updater, so the updater stays pure: React invokes
      // it twice under StrictMode, and the previous version enqueued a
      // `setHistoryIndex` from inside it on every invocation.
      const at = historyIndexRef.current + 1;
      setHistory((prev) => [...prev.slice(0, at), next]);
      moveHistoryIndex(at);
      onCanUndo?.(true);
      onCanRedo?.(false);
    },
    [moveHistoryIndex, onCanRedo, onCanUndo],
  );

  const updateRow = useCallback(
    (updated: MarkdownTableRow) => {
      commit({
        columns: snapshot.columns,
        rows: snapshot.rows.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)),
      });
    },
    [commit, snapshot],
  );

  const renameColumn = useCallback(
    (field: string, headerName: string) => {
      commit({
        columns: snapshot.columns.map((column) => (column.field === field ? { ...column, headerName } : column)),
        rows: snapshot.rows,
      });
    },
    [commit, snapshot],
  );

  const reorderRows = useCallback(
    (rows: readonly MarkdownTableRow[]) => {
      commit({ columns: snapshot.columns, rows });
    },
    [commit, snapshot.columns],
  );

  const addRow = useCallback(() => {
    const blank: Record<string, string | number> = { id: Math.max(0, ...snapshot.rows.map((r) => r.id)) + 1 };
    snapshot.columns.forEach((column) => {
      blank[column.field] = '';
    });
    const newRow = blank as MarkdownTableRow;

    const at = selectedCell?.rowId === undefined ? -1 : snapshot.rows.findIndex((r) => r.id === selectedCell.rowId);
    const rows = at === -1 ? [...snapshot.rows, newRow] : snapshot.rows.toSpliced(at + 1, 0, newRow);
    commit({ columns: snapshot.columns, rows });
  }, [commit, selectedCell?.rowId, snapshot]);

  const addColumn = useCallback(() => {
    const newColumn = { field: nextField(), headerName: `Column_${snapshot.columns.length + 1}` };
    const at =
      selectedCell?.columnField === undefined
        ? -1
        : snapshot.columns.findIndex((c) => c.field === selectedCell.columnField);
    const columns = at === -1 ? [...snapshot.columns, newColumn] : snapshot.columns.toSpliced(at + 1, 0, newColumn);
    const rows = snapshot.rows.map((row) => ({ ...row, [newColumn.field]: '' }) as MarkdownTableRow);
    commit({ columns, rows });
  }, [commit, selectedCell?.columnField, snapshot]);

  const deleteSelection = useCallback(() => {
    if (selectedRowIds.length > 0) {
      commit({ columns: snapshot.columns, rows: snapshot.rows.filter((row) => !selectedRowIds.includes(row.id)) });
      if (selectedCell?.rowId !== undefined && selectedRowIds.includes(selectedCell.rowId)) setSelectedCell(null);
      setSelectedRowIds([]);
      return;
    }
    if (selectedColumns.length === 0) return;

    const columns = snapshot.columns.filter((column) => !selectedColumns.includes(column.field));
    const rows = snapshot.rows.map((row) => {
      const next: Record<string, string | number> = { id: row.id };
      columns.forEach((column) => {
        next[column.field] = row[column.field] ?? '';
      });
      return next as MarkdownTableRow;
    });
    commit({ columns, rows });
    if (selectedCell?.columnField !== undefined && selectedColumns.includes(selectedCell.columnField)) {
      setSelectedCell(null);
    }
    setSelectedColumns([]);
  }, [commit, selectedCell, selectedColumns, selectedRowIds, snapshot]);

  const resetTable = useCallback(
    (data: MarkdownTableData) => {
      setSelectedCell(null);
      setSelectedColumns([]);
      setSelectedRowIds([]);
      commit(snapshotFromTableData(data));
    },
    [commit],
  );

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const previous = history[historyIndex - 1];
    if (previous === undefined) return;
    setSnapshot(previous);
    moveHistoryIndex(historyIndex - 1);
    setSelectedCell(null);
    onCanUndo?.(historyIndex - 1 > 0);
    onCanRedo?.(true);
  }, [history, historyIndex, moveHistoryIndex, onCanRedo, onCanUndo]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const next = history[historyIndex + 1];
    if (next === undefined) return;
    setSnapshot(next);
    moveHistoryIndex(historyIndex + 1);
    onCanUndo?.(true);
    onCanRedo?.(historyIndex + 1 < history.length - 1);
  }, [history, historyIndex, moveHistoryIndex, onCanRedo, onCanUndo]);

  const toggleColumnSelection = useCallback((field: string) => {
    setSelectedRowIds([]);
    setSelectedColumns((prev) => (prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]));
  }, []);

  const setSelectedRowIdsAndClearColumns = useCallback((ids: readonly number[]) => {
    setSelectedRowIds(ids);
    setSelectedColumns([]);
  }, []);

  const getCode = useCallback(() => serialiseMarkdownTable(tableDataFromSnapshot(snapshot)), [snapshot]);

  const selection = useMemo(
    () => ({ hasSelectedRows: selectedRowIds.length > 0, hasSelectedColumns: selectedColumns.length > 0 }),
    [selectedColumns.length, selectedRowIds.length],
  );

  return {
    columns: snapshot.columns,
    rows: snapshot.rows,
    selectedCell,
    setSelectedCell,
    selectedColumns,
    toggleColumnSelection,
    selectedRowIds,
    setSelectedRowIds: setSelectedRowIdsAndClearColumns,
    selection,
    updateRow,
    renameColumn,
    reorderRows,
    addRow,
    addColumn,
    deleteSelection,
    resetTable,
    undo,
    redo,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
    getCode,
  };
}
