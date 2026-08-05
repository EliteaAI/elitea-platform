import type { ChangeEvent, DragEvent, ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import { load as loadYaml } from 'js-yaml';

import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { BasicAccordion } from '@/shared/ui/BasicAccordion';
import { CodeMirrorEditor } from '@/shared/ui/CodeMirrorEditor';
import type { CodeMirrorSyntaxError } from '@/shared/ui/CodeMirrorEditor';
import { ExpandedViewerModal } from '@/shared/ui/ExpandedViewerModal';
import { FullScreenIcon } from '@/shared/ui/icons/full-screen-icon';
import { combineSx } from '@/shared/ui/lib/combineSx';

import { openAPIExtract } from '../../../lib/helpers/openApi.helpers';
import type { ExtractedOpenApiOperation, OpenApiDocument } from '../../../lib/helpers/openApi.helpers';
import { getCodeLanguageExtensions } from '../ToolBase/codeLanguageExtensions';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/ui/form/
 * ToolOpenAPI/OpenAPISchemaInput.jsx` (333 lines).
 *
 * DISCLOSED REDESIGNS:
 *  - `useToast().toastError(...)` (baseline's ONLY toast use in this file,
 *    firing on an unparseable schema) — no toast infra exists in this app
 *    yet (`features/agents/api/useValidateToolkit.ts`'s own doc comment,
 *    point 2, already documents this exact gap and its established
 *    resolution: an injected `onError` callback instead). This component's
 *    optional `onInvalidSchema` prop replaces it.
 *  - `useLanguageLinter(detectedLanguage)` -> `../ToolBase/
 *    codeLanguageExtensions.ts`'s `getCodeLanguageExtensions` (A4b's own
 *    port, already landed, already documents the real, disclosed scope gap:
 *    this app has only `@codemirror/lang-json` installed, no YAML language
 *    package). `detectedLanguage` (`'json'`/`'yaml'`) is still computed and
 *    still forwarded to the SAME helper, faithfully preserving the
 *    detection logic — a YAML document simply gets the helper's existing
 *    plain-text fallback (still fully editable, just unhighlighted),
 *    exactly as A4b's own file already discloses for every non-JSON caller.
 *  - `Modal.ExpandedViewerModal`'s baseline props (`value`/`specifiedLanguage`/
 *    `disableSelectLanguage`) -> `shared/ui`'s `ExpandedViewerModal` takes a
 *    plain `content: ReactNode` slot instead (no built-in "value" concept) —
 *    the same `CodeMirrorEditor` instance (full-height) is rendered into
 *    that slot; omitting the `language` prop hides the content-type
 *    selector entirely, the same visible effect as the baseline's
 *    `disableSelectLanguage`.
 *  - `Tooltip`/`StyledTooltip` (`@/ComponentsLib/Tooltip`) -> plain MUI
 *    `Tooltip` — `shared/ui` has no themed tooltip wrapper for a bare
 *    icon-button trigger (its tooltip components are markdown-content or
 *    label-truncation specific); MUI's own `Tooltip` provides the same
 *    hover-title behaviour.
 */
export interface OpenAPISchemaInputProps {
  readonly containerSX?: SxProps<Theme>;
  readonly value: string | undefined;
  readonly onValueChange: (newValue: string, parsedActions: readonly ExtractedOpenApiOperation[], description: string) => void;
  readonly error?: boolean;
  readonly helperText?: string;
  readonly onSyntaxError?: (errors: readonly CodeMirrorSyntaxError[]) => void;
  readonly setToolErrors: (updater: (prevErrors: Record<string, boolean>) => Record<string, boolean>) => void;
  readonly onInvalidSchema?: () => void;
}

interface ParsedSchemaResult {
  readonly parsedActions: readonly ExtractedOpenApiOperation[];
  readonly fileData: unknown;
  readonly description: string;
}

function hasPaths(value: unknown): value is { readonly paths: unknown } {
  return typeof value === 'object' && value !== null && 'paths' in value;
}

function readDescription(fileData: unknown): string {
  if (typeof fileData !== 'object' || fileData === null) return '';
  const record = fileData as { readonly description?: unknown; readonly info?: { readonly description?: unknown } };
  if (typeof record.description === 'string') return record.description;
  if (typeof record.info?.description === 'string') return record.info.description;
  return '';
}

export function OpenAPISchemaInput({
  containerSX,
  value,
  onValueChange,
  error,
  helperText,
  onSyntaxError,
  setToolErrors,
  onInvalidSchema,
}: OpenAPISchemaInputProps): ReactNode {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  const parseSchemaActions = useCallback(
    (data: string, showError: boolean): ParsedSchemaResult => {
      let fileData: unknown = '';
      try {
        try {
          fileData = JSON.parse(data) as unknown;
        } catch {
          fileData = loadYaml(data);
        }
        if (!hasPaths(fileData)) {
          if (showError) onInvalidSchema?.();
          setToolErrors((prevErrors) => ({ ...prevErrors, openApiSchema: true }));
          return { parsedActions: [], fileData, description: '' };
        }
      } catch {
        if (showError) onInvalidSchema?.();
        setToolErrors((prevErrors) => ({ ...prevErrors, openApiSchema: true }));
        return { parsedActions: [], fileData, description: '' };
      }
      const parsedActions = openAPIExtract(fileData as OpenApiDocument);
      const description = readDescription(fileData);
      setToolErrors((prevErrors) => (prevErrors.openApiSchema ? { ...prevErrors, openApiSchema: false } : prevErrors));
      return { parsedActions, fileData, description };
    },
    [onInvalidSchema, setToolErrors],
  );

  const handleFile = useCallback(
    (isForDragDrop: boolean) => (event: DragEvent<HTMLElement> | ChangeEvent<HTMLInputElement>) => {
      event.preventDefault();
      setIsDragOver(false);
      const file = isForDragDrop ? (event as DragEvent<HTMLElement>).dataTransfer.files[0] : (event as ChangeEvent<HTMLInputElement>).target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        // `FileReader.result` is typed `string | ArrayBuffer | null` — only
        // ever a `string` here in practice (`readAsText`, below), but a bare
        // `String(result)` would silently stringify an `ArrayBuffer` to
        // `'[object ArrayBuffer]'` if that type-level possibility were ever
        // real; narrowing explicitly documents that it never is for this
        // reader.
        const result = loadEvent.target?.result;
        const contents = typeof result === 'string' ? result : '';
        const { parsedActions, fileData, description } = parseSchemaActions(contents, true);
        const schemaString = fileData ? JSON.stringify(fileData, null, 2) : '';
        onValueChange(schemaString, parsedActions, description);
      };
      reader.readAsText(file);
    },
    [onValueChange, parseSchemaActions],
  );

  const onClickChooseFile = useCallback(() => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.txt,.yml,.yaml';
    fileInput.onchange = (event) => handleFile(false)(event as unknown as ChangeEvent<HTMLInputElement>);
    fileInput.click();
  }, [handleFile]);

  const onChangeSchema = useCallback(
    (newValue: string) => {
      const { parsedActions, description } = parseSchemaActions(newValue, false);
      onValueChange(newValue, parsedActions, description);
    },
    [onValueChange, parseSchemaActions],
  );

  const detectedLanguage = useMemo<'json' | 'yaml'>(() => {
    try {
      JSON.parse(value ?? '');
      return 'json';
    } catch {
      return 'yaml';
    }
  }, [value]);

  const extensions = useMemo(() => getCodeLanguageExtensions(detectedLanguage), [detectedLanguage]);

  const handleOpenFullScreen = useCallback(() => setIsFullScreen(true), []);
  const handleCloseFullScreen = useCallback(() => setIsFullScreen(false), []);

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragOver(true);
  }, []);
  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragOver(false);
  }, []);

  return (
    <Box sx={combineSx(baseContainerSx, containerSX)}>
      <BasicAccordion
        showMode="left"
        items={[
          {
            title: t('features.toolkits.openApiSchemaInput.schemaTitle', 'Schema'),
            content: (
              <FormControl
                error={Boolean(error)}
                sx={formControlSx}
              >
                <Box
                  sx={editorWrapperSx(isDragOver)}
                  onDrop={handleFile(true)}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                >
                  <Box
                    aria-label="full-scrn-btn"
                    sx={fullScreenWrapperSx}
                  >
                    <Tooltip
                      title={t('features.toolkits.openApiSchemaInput.fullScreenView', 'Full screen view')}
                      placement="top"
                    >
                      <IconButton onClick={handleOpenFullScreen}>
                        <FullScreenIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  {!value && (
                    <Typography
                      sx={placeholderTextSx}
                      variant="bodyMedium"
                    >
                      {t('features.toolkits.openApiSchemaInput.placeholderText', 'Enter or drag&drop your OpenAPI schema here, or  ')}
                      <Box
                        component="span"
                        sx={chooseFileLinkSx}
                        onClick={onClickChooseFile}
                      >
                        {t('features.toolkits.openApiSchemaInput.chooseFile', 'choose file')}
                      </Box>
                    </Typography>
                  )}
                  <CodeMirrorEditor
                    value={value ?? ''}
                    onChange={onChangeSchema}
                    extensions={[...extensions]}
                    {...(onSyntaxError !== undefined ? { onSyntaxError } : {})}
                  />
                </Box>
                <FormHelperText>{error ? helperText : undefined}</FormHelperText>
              </FormControl>
            ),
          },
        ]}
      />

      {isFullScreen && (
        <ExpandedViewerModal
          open={isFullScreen}
          onClose={handleCloseFullScreen}
          title={t('features.toolkits.openApiSchemaInput.schemaTitle', 'Schema')}
          content={
            <Box sx={fullscreenEditorWrapperSx}>
              <CodeMirrorEditor
                value={value ?? ''}
                onChange={onChangeSchema}
                extensions={[...extensions]}
                {...(onSyntaxError !== undefined ? { onSyntaxError } : {})}
              />
            </Box>
          }
        />
      )}
    </Box>
  );
}

const baseContainerSx: SxProps<Theme> = { display: 'flex', flexDirection: 'column', marginTop: '0.5rem' };

const formControlSx: SxProps<Theme> = {
  width: '100%',
  height: '25rem',
  padding: '0.5rem 0rem',
  boxSizing: 'border-box',
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
};

const editorWrapperSx = (isDragOver: boolean): SxProps<Theme> => (theme: Theme) => ({
  height: '100%',
  width: '100%',
  position: 'relative',
  borderRadius: theme.vars.shape.radiusMd,
  overflow: 'hidden',
  border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
  backgroundColor: isDragOver ? theme.vars.palette.text.contextHighLight : 'transparent',
  '&:hover': { '& [aria-label="full-scrn-btn"]': { display: 'block' } },
});

const placeholderTextSx: SxProps<Theme> = (theme: Theme) => ({
  position: 'absolute',
  top: '0.5rem',
  left: '3.625rem',
  zIndex: 100,
  pointerEvents: 'none',
  color: theme.vars.palette.text.button.disabled,
});

const chooseFileLinkSx: SxProps<Theme> = { textDecoration: 'underline', cursor: 'pointer', pointerEvents: 'auto' };

const fullScreenWrapperSx: SxProps<Theme> = {
  position: 'absolute',
  display: 'none',
  top: '0.25rem',
  right: '0.25rem',
  zIndex: 10,
  '& svg': { width: '0.7rem', height: '0.7rem' },
  '&:hover': { button: { background: 'transparent' } },
};

const fullscreenEditorWrapperSx: SxProps<Theme> = { flex: 1, minHeight: 0, height: '100%', display: 'flex' };
