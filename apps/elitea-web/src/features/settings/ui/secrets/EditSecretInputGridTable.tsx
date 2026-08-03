/**
 * Inline editable cell for the secrets DataGrid.
 *
 * Renders an `<input>` (or `<textarea>` for multi-line) within the DataGrid
 * cell, with validation for name fields (alphanumeric + `_` / `-` only) and
 * a character limit.  Pressing Enter exits edit mode; Shift+Enter inserts a
 * newline.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/secrets/
 * EditSecretInputGridTable.jsx`.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SxProps, Theme } from '@mui/material/styles';
import TextField from '@mui/material/TextField';

import { t } from '@/shared/ui/lib/t';

const MAX_SECRET_LENGTH = 1000;
const NAME_PATTERN = /^[a-zA-Z0-9_-]*$/;

export interface EditSecretInputGridTableProps {
  /** Unique row identifier. */
  id: string;
  /** Field being edited: `"name"` | `"secretValue"`. */
  field: 'name' | 'secretValue';
  /** Current displayed value. */
  value: string;
  /** Full row data (used to check `isNew` for focus behaviour). */
  row: { readonly isNew: boolean };
  /** Called on every change to update the row store. */
  onChange: (id: string, field: string, newValue: string) => void;
  /** Set the row mode — called on Enter / cancel. */
  onExitEditMode: (id: string) => void;
  /** Validation callback. */
  onValidationChange: (id: string, field: string, hasError: boolean) => void;
}

export const EditSecretInputGridTable = memo(function EditSecretInputGridTable({
  id,
  field,
  value,
  row,
  onChange,
  onExitEditMode,
  onValidationChange,
}: EditSecretInputGridTableProps) {
  const [inputValue, setInputValue] = useState(value);

  /* ── validation ───────────────────────────────────────────────────── */
  const validationError = useMemo(() => {
    if (field === 'name' && inputValue && !NAME_PATTERN.test(inputValue)) {
      return t('entities.secret.validation.invalidName', 'Only alphanumeric characters, underscore and hyphen are allowed');
    }
    return null;
  }, [field, inputValue]);

  const isAtLimit = inputValue.length >= MAX_SECRET_LENGTH;

  useEffect(() => {
    onValidationChange(id, field, Boolean(validationError) || isAtLimit);
  }, [id, field, validationError, isAtLimit, onValidationChange]);

  /* ── handlers ─────────────────────────────────────────────────────── */
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setInputValue(newValue);
      onChange(id, field, newValue);
    },
    [id, field, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          // Shift+Enter: insert newline (textarea only)
          e.preventDefault();
          const target = e.currentTarget as HTMLTextAreaElement;
          const start = target.selectionStart;
          const end = target.selectionEnd;
          const newValue = inputValue.slice(0, start) + '\n' + inputValue.slice(end);
          setInputValue(newValue);
          onChange(id, field, newValue);
          setTimeout(() => {
            target.setSelectionRange(start + 1, start + 1);
          }, 0);
        } else {
          // Enter: exit edit mode
          e.preventDefault();
          onExitEditMode(id);
        }
      }
    },
    [id, field, inputValue, onChange, onExitEditMode],
  );

  /* ── render ───────────────────────────────────────────────────────── */
  const helperText = validationError || (isAtLimit ? `${MAX_SECRET_LENGTH}` : undefined);

  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  useEffect(() => {
    if (field === 'name' && row.isNew) {
      inputRef.current?.focus();
    }
  }, [field, row.isNew]);

  return (
    <TextField
      fullWidth
      multiline
      maxRows={15}
      inputRef={inputRef}
      value={inputValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      error={Boolean(validationError) || isAtLimit}
      helperText={helperText}
      slotProps={{
        htmlInput: { maxLength: MAX_SECRET_LENGTH },
      }}
      sx={styles.input}
    />
  );
});

const styles: Record<string, SxProps<Theme>> = {
  input: {
    // Padding handled by MuiInputBase override (mui-overrides/MuiInputBase.ts).
  },
};
