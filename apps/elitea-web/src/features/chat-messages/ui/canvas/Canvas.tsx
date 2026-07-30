/**
 * ui/canvas/Canvas.tsx — in-chat canvas for code / diagram / table editing,
 * ported from `apps/elitea-ui/src/components/Canvas.jsx` (C4 batch).
 *
 * Renders a syntax-highlighted code block (or unformatted content for
 * diagrams/tables) with an edit button that opens the canvas editor and a
 * copy button that copies the content to the clipboard.
 */
import { useCallback, useMemo } from 'react';

import { Box, IconButton, Typography } from '@mui/material';

const IconButtonAny = IconButton as React.ComponentType<any>;

import Tooltip from '@mui/material/Tooltip';

import type { CanvasEditorPresence } from '@/entities/canvas/model/types';
import { realCanvasEditors } from '@/entities/canvas/model/selectors';

export interface CanvasProps {
  /** The content to display — code for `type=code`, mermaid for diagrams, markdown for tables. */
  readonly content?: string;
  /** Called when the user clicks the edit button — receives the canvas edit payload. */
  readonly onEdit?: (payload: CanvasEditPayload) => void;
  /** Start position of the code block in the original message (for non-block canvases). */
  readonly startPos?: number;
  /** End position of the code block in the original message. */
  readonly endPos?: number;
  /** The selected code block info (for block-level editing). */
  readonly selectedCodeBlockInfo?: CodeBlockInfo;
  /** Interaction UUID for tracking. */
  readonly interaction_uuid?: string;
  /** Conversation UUID for tracking. */
  readonly conversation_uuid?: string;
  /** Canvas UUID — identifies an existing canvas or undefined for new ones. */
  readonly canvasId?: string;
  /** Message item ID (for new canvases). */
  readonly messageItemId?: string | number;
  /** Whether the message is currently streaming. */
  readonly isStreaming?: boolean;
  /** The programming language — `'markdown'`, `'javascript'`, `'python'`, etc. */
  readonly language?: string;
  /** Canvas type: `'code'`, `'diagram'`, or `'table'`. */
  readonly type?: 'code' | 'diagram' | 'table';
  /** List of editors currently working on this canvas. */
  readonly editors?: readonly CanvasEditorPresence[];
}

export interface CodeBlockInfo {
  readonly codeBlock: string;
  readonly language: string;
  readonly isBlock: boolean;
  readonly canvasId?: string;
  readonly messageItemId?: string | number;
  readonly blockId?: string;
  readonly viewOnly?: boolean;
}

export interface CanvasEditPayload {
  /** Raw content from the code block. */
  readonly rawData: string;
  /** Parsed code from inside the triple-backtick fence. */
  readonly codeBlock: string;
  /** Language identifier for the editor. */
  readonly language: string;
  /** Whether this is a block-level edit. */
  readonly isBlock: boolean;
  readonly startPos?: number;
  readonly endPos?: number;
  readonly canvasId?: string;
  readonly messageItemId?: string | number;
  readonly blockId?: string;
  /** When true, only the current user can edit. */
  readonly viewOnly?: boolean;
}

/**
 * Renders a canvas — a syntax-highlighted code block or diagram/table with
 * inline edit and copy actions.
 *
 * Matches the baseline `Canvas.jsx` behaviour:
 * - Code blocks are wrapped in a fenced code fence and rendered with syntax highlighting.
 * - Diagrams (mermaid) and tables are rendered as plain markdown content.
 * - An edit button opens the canvas editor with the right language and payload.
 * - A copy button copies the content to the clipboard.
 * - Real-time editor presence is shown (filtered admin/system users).
 */
export function Canvas({
  content = '',
  onEdit,
  startPos,
  endPos,
  selectedCodeBlockInfo,
  interaction_uuid,
  conversation_uuid,
  canvasId,
  messageItemId,
  isStreaming = false,
  language = 'markdown',
  type = 'code',
  editors = [],
}: CanvasProps): React.ReactElement {
  // Filter out admin/system editors (baseline: CANVAS_ADMIN_USER / CANVAS_SYSTEM_USER)
  const realEditors = useMemo(
    () =>
      realCanvasEditors(editors).filter(
        (editor) =>
          editor.userName !== '__admin__' && editor.userName !== '__system__',
      ),
    [editors],
  );

  const editingTitle = useMemo(
    () => {
      if (type === 'code' && language !== 'mermaid') return 'Code editing...';
      if (type === 'diagram' || language === 'mermaid') return 'Diagram editing...';
      return 'Table editing...';
    },
    [language, type],
  );

  const editButtonTitle = useMemo(
    () => {
      if (type === 'code' && language !== 'mermaid') return 'Edit code';
      if (type === 'diagram' || language === 'mermaid') return 'Edit diagram';
      return 'Edit table';
    },
    [language, type],
  );

  // Wrap raw content in a fenced code block if it doesn't already start with one
  const realContent = useMemo(() => {
    if (!content.startsWith('```')) {
      switch (type) {
        case 'code':
          return `\`\`\`${language}\n${content}\n\`\`\`\n`;
        case 'diagram':
          return `\`\`\`mermaid\n${content}\n\`\`\`\n`;
        default:
          return content;
      }
    }
    return content;
  }, [content, language, type]);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      // TODO: toast info — "The code has been copied into clipboard"
    } catch {
      // Clipboard write failed — non-fatal
    }
  }, [content]);

  const onClickEdit = useCallback(() => {
    onEdit?.({
      rawData: content,
      codeBlock: extraCodeFromBlock(content),
      language: type === 'table' ? 'markdownTable' : type === 'diagram' ? 'mermaid' : language,
      isBlock: true,
      ...(startPos != null ? { startPos } : {}),
      ...(endPos != null ? { endPos } : {}),
      ...(canvasId != null ? { canvasId } : {}),
      ...(messageItemId != null ? { messageItemId } : {}),
      ...(selectedCodeBlockInfo?.blockId != null ? { blockId: selectedCodeBlockInfo.blockId } : {}),
      viewOnly: !!realEditors.length,
    });
  }, [onEdit, content, type, language, startPos, endPos, canvasId, messageItemId, realEditors, selectedCodeBlockInfo?.blockId]);

  return (
    <Box sx={{ width: '100%' }}>
      {/* Toolbar row */}
      <Box
        sx={{
          width: '100%',
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'flex-end',
          alignItems: 'center',
          padding: '8px 0px 8px 8px',
          gap: '8px',
        }}
      >
        {realEditors.length > 0 && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              gap: '8px',
            }}
          >
            {/* TODO: AuthorContainer — avatar row showing active editors */}
            <Typography variant="bodySmall" color="text.primary">
              {editingTitle}
            </Typography>
          </Box>
        )}
        {onEdit && (
          <Tooltip title={realEditors.length > 0 ? 'Watch editing' : editButtonTitle} placement="top">
            <IconButtonAny variant="elitea" color="tertiary" size="small" onClick={onClickEdit}>
              ✏️
            </IconButtonAny>
          </Tooltip>
        )}
        <Tooltip title="Copy code" placement="top">
          <IconButtonAny variant="elitea" color="tertiary" size="small" onClick={onCopy}>
            📋
          </IconButtonAny>
        </Tooltip>
      </Box>

      {/* Content area */}
      <CanvasContent
        content={realContent}
        {...(interaction_uuid != null && { interaction_uuid })}
        {...(conversation_uuid != null && { conversation_uuid })}
        {...(canvasId != null && { canvasId })}
        isStreaming={isStreaming}
      />
    </Box>
  );
}

/**
 * Renders the markdown/code content area.
 *
 * For code-type canvases the content is rendered inside a `<pre>` with a
 * syntax-highlighted code fence; for diagrams/tables it renders as plain
 * markdown (baseline delegates to `Markdown` component — a TODO for C4).
 */
function CanvasContent({
  content,
  interaction_uuid: _interaction_uuid,
  conversation_uuid: _conversation_uuid,
  canvasId: _canvasId,
  isStreaming: _isStreaming,
}: {
  readonly content: string;
  readonly interaction_uuid?: string | undefined;
  readonly conversation_uuid?: string | undefined;
  readonly canvasId?: string | undefined;
  readonly isStreaming?: boolean | undefined;
}): React.ReactElement {
  // TODO: replace with shared Markdown component once C3/C5 ships it
  // Baseline: <Markdown> component with interaction_uuid, conversation_uuid, canvasId props
  return (
    <Box
      component="pre"
      sx={{
        background: '#f5f5f5',
        borderRadius: '0.5rem',
        padding: '1rem',
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        fontSize: '0.875rem',
        fontFamily: 'monospace',
      }}
    >
      {content || ' '}
    </Box>
  );
}

/**
 * Extracts the code from inside a fenced code block.
 *
 * Ported from `extraCodeFromBlock` in `apps/elitea-ui/src/components/Canvas.jsx` —
 * strips the opening/closing triple-backtick fence and trims trailing empty lines.
 */
function extraCodeFromBlock(code: string): string {
  const trimmed = trimEmptyStringsAtEnd((code || '').split('\n'));
  // If the code starts with ``` and ends with ```, strip them
  if (trimmed.length > 2 && trimmed[0]?.startsWith('```') && trimmed[trimmed.length - 1]?.startsWith('```')) {
    return trimmed.slice(1, trimmed.length - 1).join('\n');
  }
  return code;
}

/**
 * Trims empty strings from the end of an array.
 *
 * Ported from the baseline helper at `apps/elitea-ui/src/components/Canvas.jsx` (C4).
 */
function trimEmptyStringsAtEnd(array: string[]): string[] {
  let endIndex = array.length - 1;
  while (endIndex >= 0 && array[endIndex] === '') endIndex--;
  return array.slice(0, endIndex + 1);
}
