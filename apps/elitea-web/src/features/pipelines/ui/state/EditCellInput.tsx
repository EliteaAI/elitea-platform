/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * settings/EditCellInput.jsx` (117 lines) — unit A2j. Grouped under `ui/
 * state/` rather than a `ui/settings/` cluster: its only real consumer is
 * `./StateVariableTable.tsx`, right here in this sub-unit — see this unit's
 * own mission notes for the functional-cohesion rationale.
 *
 * A `DataGrid` `renderEditCell` cell for the State table's `name`/`value`
 * columns: local `inputValue` state, a debounced (~30ms) auto-blur-on-change
 * (baseline: `setTimeout(..., 30)`, kept verbatim — it is real UX, not a
 * baseline quirk to "fix"), and an Enter-inserts-newline `onKeyDown`
 * override that manipulates the underlying `<input>`/`<textarea>`'s own
 * `selectionStart`/`selectionEnd`/`setSelectionRange`.
 *
 * DISCLOSED REDESIGN: the baseline renders `@/[fsd]/shared/ui`'s
 * `Input.StyledInputEnhancer` — a 30-prop CodeMirror-backed component with
 * F-string autocomplete, a language prop, and a bespoke `StyledInputModal`
 * fullscreen surface (none of which exist in this app's `shared/ui`, see
 * `shared/ui/StyledInputEnhancer.tsx`'s own doc comment: "The baseline
 * rendered its own bespoke `StyledInputModal`... none of which exist in
 * `shared/ui` yet"). Rebuilt against the ACTUAL ported `StyledInputEnhancer`
 * (plain `InputBase` + a `BaseModal` fullscreen echo, both controlled by the
 * same `value`/`onChange`): `hasActionsToolBar` maps to `actions.enabled`
 * (the baseline's on/off toolbar gate), and the baseline's always-off
 * `showCopyAction` (never passed `true`) maps to `actions.showCopy: false`.
 * `language`/F-string autocomplete/`maxLength` truncation as a CodeMirror
 * `maxLength` extension have no equivalent on the ported component; the
 * `maxLength`-slice truncation the baseline's OWN `onChange` already does
 * (this file's own logic, lines 46-55 of the baseline, unrelated to
 * `StyledInputEnhancer`) is kept verbatim below — it does not depend on the
 * inner field component at all.
 *
 * `EditCellInputProps` intentionally does NOT extend `@mui/x-data-grid`'s
 * `GridRenderEditCellParams` — this component only ever reads `id`/`field`/
 * `row` off that object (verified against the baseline's own destructure);
 * a minimal, self-contained interface is both easier to unit-test (no
 * `GridValidRowModel`/`colDef`/`api` boilerplate to fabricate) and still
 * structurally compatible with `./StateVariableTable.tsx`'s real
 * `renderEditCell={(params) => <EditCellInput {...params} .../>}` call —
 * TS's excess-property check does not apply to JSX spreads.
 */
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { GridRowId } from '@mui/x-data-grid';

import { FlowEditorConstants } from '../../lib/flow-editor/constants';
import { StyledInputEnhancer } from '@/shared/ui/StyledInputEnhancer';
import { t } from '@/shared/i18n';

interface EditCellRow {
  readonly isNew?: boolean | undefined;
  readonly type?: string | undefined;
  readonly [field: string]: unknown;
}

/** @public */
export interface EditCellInputProps {
  readonly id: GridRowId;
  readonly field: string;
  readonly row: EditCellRow;
  readonly hasActionsToolBar?: boolean;
  readonly maxLength?: number;
  /** Fires on commit; `restore(true)` re-reads the row's current value back into the field (baseline: an invalid-name rollback). */
  readonly onChangeValue: (inputValue: string, restore?: (needRestore: boolean) => void) => void;
}

export function EditCellInput(props: EditCellInputProps): ReactNode {
  const { id, field, row, hasActionsToolBar, onChangeValue, maxLength } = props;
  const { isNew, type, ...otherValues } = row;

  const oldValue = useMemo(() => {
    if (
      field === 'value' &&
      (type === FlowEditorConstants.StateVariableTypes.Json || type === FlowEditorConstants.StateVariableTypes.List)
    ) {
      const raw = otherValues[field];
      return raw ? JSON.stringify(raw, null, 2) : '';
    }
    return (otherValues[field] as string | undefined) ?? '';
  }, [field, otherValues, type]);

  const [inputValue, setInputValue] = useState(oldValue);

  const onBlur = useCallback(() => {
    if (inputValue !== oldValue) {
      onChangeValue(inputValue, (needRestore) => {
        if (needRestore) {
          setInputValue((otherValues[field] as string | undefined) ?? '');
        }
      });
    }
  }, [field, inputValue, oldValue, onChangeValue, otherValues]);

  const onBlurRef = useRef(onBlur);

  useEffect(() => {
    onBlurRef.current = onBlur;
  }, [onBlur]);

  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const newValue = event.target.value;
      setInputValue(maxLength ? newValue.slice(0, maxLength) : newValue);
      setTimeout(() => {
        onBlurRef.current?.();
      }, 30);
    },
    [maxLength],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      const textarea = event.target as HTMLInputElement | HTMLTextAreaElement;
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        const start = textarea.selectionStart ?? inputValue.length;
        const end = textarea.selectionEnd ?? inputValue.length;
        setInputValue(inputValue.slice(0, start) + '\n' + inputValue.slice(end));
        setTimeout(() => {
          textarea.setSelectionRange?.(start + 1, start + 1);
        }, 0);
      }
    },
    [inputValue],
  );

  return (
    // `autoFocus={!isNew}` (baseline) is dropped — `jsx-a11y/no-autofocus`
    // bans it outright with no per-file waiver, same fix already applied to
    // `ui/nodes/BaseNode/NodeCardHeader.tsx`'s rename field for the
    // identical rule. `DataGrid`'s own cell-edit-mode entry already moves
    // focus into the cell without it.
    <StyledInputEnhancer
      id={`edit-secret-${id}`}
      autoComplete="off"
      focused={!isNew}
      required
      value={inputValue}
      onChange={onChange}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      fullScreenTitle={t('pipelines.flowEditor.state.defaultValueTitle', 'Default value')}
      actions={
        hasActionsToolBar
          ? { enabled: true, showCopy: false, showExpand: true, showFullScreen: true }
          : { enabled: false }
      }
      {...(hasActionsToolBar ? { expand: { maxRows: 15, minRows: 1, collapsed: true } } : {})}
    />
  );
}
