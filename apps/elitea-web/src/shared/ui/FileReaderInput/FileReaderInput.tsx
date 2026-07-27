import type { ChangeEvent, DragEvent, ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';

import { load as loadYaml } from 'js-yaml';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { BaseBtn } from '../BaseBtn';
import { InputBase, type InputBaseExpandOptions } from '../InputBase';
import { combineSx } from '../lib/combineSx';
import { t } from '../lib/t';

/** @public */
export interface FileReaderInputFileOptions {
  /** Lower-case extensions without the dot, e.g. `['json', 'yaml', 'yml', 'txt']`. Omit to accept any file. */
  acceptExtensions?: string[];
  /** Omit for no limit. */
  maxSizeBytes?: number;
}

/** @public */
export type FileRejectionReason = 'extension' | 'size' | 'parse';

const DEFAULT_EXPAND: InputBaseExpandOptions = { minRows: 3, maxRows: 15 };

/**
 * Pure validation, checked before any file is read. Exported for direct unit
 * testing (and this unit's mutation-testing proof) rather than only being
 * exercised indirectly through the component.
 */
export function validateFile(file: File, options: FileReaderInputFileOptions | undefined): FileRejectionReason | null {
  const { acceptExtensions, maxSizeBytes } = options ?? {};
  if (acceptExtensions && acceptExtensions.length > 0) {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!acceptExtensions.includes(extension)) return 'extension';
  }
  if (maxSizeBytes !== undefined && file.size > maxSizeBytes) return 'size';
  return null;
}

/**
 * Turns raw file text into the string `onChange` receives. YAML/YML files
 * are parsed and re-serialised as JSON — matching the baseline's own
 * behaviour (`apps/elitea-ui/…/FileReaderInput.jsx`'s
 * `fileData = { context: JSON.stringify(yamlData) }`) — every other
 * extension passes through unchanged. Throws on unparsable YAML; the caller
 * turns that into a `'parse'` rejection.
 */
export function parseFileContent(text: string, fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension === 'yaml' || extension === 'yml') {
    return JSON.stringify(loadYaml(text));
  }
  return text;
}

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface FileReaderInputProps {
  value: string;
  onChange: (value: string) => void;
  label?: ReactNode;
  /** Extension/size gate, checked before a dropped or picked file is read. */
  file?: FileReaderInputFileOptions;
  onFileAccepted?: (file: File) => void;
  onFileRejected?: (file: File, reason: FileRejectionReason) => void;
  /** @default `{ minRows: 3, maxRows: 15 }` */
  expand?: InputBaseExpandOptions;
  sx?: SxProps<Theme>;
}

function containerSx(isDragging: boolean) {
  return (theme: Theme) => ({
    borderRadius: theme.vars.shape.radiusMd,
    transition: 'background-color 0.15s ease-in-out',
    backgroundColor: isDragging ? theme.vars.palette.text.contextHighLight : 'transparent',
  });
}

const footerSx = (theme: Theme) => ({
  display: 'flex',
  justifyContent: 'flex-end',
  marginTop: theme.spacing(1),
});

/**
 * A text field that also accepts a dropped or picked file, reading its
 * contents in with the browser's `FileReader` API. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/input/FileReaderInput.jsx`
 * (`FileReaderEnhancer`).
 *
 * R-C1 fix, not in the baseline: the baseline accepted a file ONLY via
 * drag-and-drop — no way to attach one without a mouse. This adds a real
 * "Attach a file" button wired to a native, hidden `<input type="file">`
 * (the standard accessible-file-upload pattern: the visible, focusable
 * button is the control; the native input supplies the file picker).
 *
 * Also new: `file.acceptExtensions`/`maxSizeBytes` validation
 * (`validateFile`) before a file is ever read — the baseline read and
 * `JSON.stringify`'d whatever was dropped unconditionally.
 *
 * Dropped from the baseline: the `updateVariableList`/`stateVariableOptions`
 * F-string variable-highlighting integration and the imperative
 * `restoreValue`/`getInputContent`/`replaceRange` ref handle — both are
 * concerns of the app-level prompt editor this component fed in the
 * baseline, not of a generic file-backed text field.
 */
export function FileReaderInput({
  value,
  onChange,
  label,
  file,
  onFileAccepted,
  onFileRejected,
  expand = DEFAULT_EXPAND,
  sx,
}: FileReaderInputProps): ReactNode {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    (candidate: File) => {
      const rejection = validateFile(candidate, file);
      if (rejection) {
        onFileRejected?.(candidate, rejection);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const raw = typeof reader.result === 'string' ? reader.result : '';
        try {
          onChange(parseFileContent(raw, candidate.name));
          onFileAccepted?.(candidate);
        } catch {
          onFileRejected?.(candidate, 'parse');
        }
      };
      reader.onerror = () => {
        onFileRejected?.(candidate, 'parse');
      };
      reader.readAsText(candidate);
    },
    [file, onChange, onFileAccepted, onFileRejected],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const dropped = event.dataTransfer.files[0];
      if (dropped) processFile(dropped);
    },
    [processFile],
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const picked = event.target.files?.[0];
      // Reset so picking the same file again still fires a change event.
      event.target.value = '';
      if (picked) processFile(picked);
    },
    [processFile],
  );

  const handleTextChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(event.target.value);
    },
    [onChange],
  );

  return (
    <Box
      data-dragging={isDragging}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      sx={combineSx(containerSx(isDragging), sx)}
    >
      <InputBase
        label={label}
        value={value}
        onChange={handleTextChange}
        expand={expand}
      />
      <Box sx={footerSx}>
        <BaseBtn
          variant="secondary"
          onClick={handleBrowseClick}
        >
          {t('shared.ui.fileReaderInput.browse', 'Attach a file')}
        </BaseBtn>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          accept={file?.acceptExtensions?.map((ext) => `.${ext}`).join(',')}
          onChange={handleFileInputChange}
        />
      </Box>
    </Box>
  );
}
