/**
 * One wiki page, rendered — with every mermaid block drawn, and a quick fix
 * offered for one that fails (DWIKI-007/008).
 *
 * WHY THIS IS A WIDGET. `shared/ui/Markdown` does not draw mermaid, and the
 * quick fix — the model round trip that rewrites a broken diagram — is
 * `features/chat-messages`' `useMermaidQuickFix`, which `no-sideways-features`
 * lets only a widget import. So the page is split HERE: text runs go through
 * `Markdown`, each ```mermaid block through `MermaidDiagram`, and the fix
 * control sits beside the block that failed, exactly as the canvas composes
 * the same three pieces.
 *
 * THE FIX IS PROPOSED, NOT APPLIED. The legacy flow (DeepWikiApp.jsx:3205-3341)
 * showed the repaired block against the current one and saved only on Accept;
 * Undo restored the pre-fix content and saved that. Both are kept, and both
 * SAVE — a fix that only changed the screen would be gone on the next read.
 */
import { useCallback, useMemo, useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useQueryClient } from '@tanstack/react-query';

import { putWikiPage } from '@/entities/wiki';
import { MermaidQuickFixButton, useMermaidQuickFix } from '@/features/chat-messages';
import { extractMermaidBlocks, replaceMermaidBlock } from '@/features/wiki-editing';
import { t } from '@/shared/i18n';
import { lineDiff } from '@/shared/lib/lineDiff';
import { DiffView } from '@/shared/ui/DiffView';
import { Markdown } from '@/shared/ui/Markdown';
import { MermaidDiagram } from '@/shared/ui/MermaidDiagram';

interface WikiPageReaderProps {
  readonly projectId: string | number;
  /** `{wiki_id}/wiki_pages/...` — the object key the page is saved back under. */
  readonly pageKey: string;
  readonly markdown: string;
}

/** A proposed repair, held until the user decides. */
interface PendingFix {
  readonly blockIndex: number;
  readonly fixed: string;
}

/** The content before the last accepted fix, kept so it can be undone. */
interface AppliedFix {
  readonly previous: string;
}

/** Split markdown into text runs and mermaid blocks, in document order. */
function segments(markdown: string): { kind: 'text' | 'mermaid'; text: string; index: number }[] {
  const lines = markdown.split('\n');
  const blocks = extractMermaidBlocks(markdown);
  const out: { kind: 'text' | 'mermaid'; text: string; index: number }[] = [];
  let cursor = 0;
  for (const block of blocks) {
    // startLine is the 1-indexed line AFTER the fence; the fence itself is
    // startLine - 1 (0-indexed startLine - 2). endLine is the 1-indexed closing
    // fence.
    const fenceStart = block.startLine - 2;
    const fenceEnd = block.endLine - 1;
    if (fenceStart > cursor) {
      out.push({ kind: 'text', text: lines.slice(cursor, fenceStart).join('\n'), index: -1 });
    }
    out.push({ kind: 'mermaid', text: block.code, index: block.index });
    cursor = fenceEnd + 1;
  }
  if (cursor < lines.length) {
    out.push({ kind: 'text', text: lines.slice(cursor).join('\n'), index: -1 });
  }
  return out;
}

export function WikiPageReader({ projectId, pageKey, markdown }: WikiPageReaderProps): React.JSX.Element {
  const queryClient = useQueryClient();
  // The content on screen. It starts as what was fetched and moves as fixes
  // are accepted or undone; every move is also SAVED, so the two never differ
  // for longer than one request.
  const [content, setContent] = useState(markdown);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [pending, setPending] = useState<PendingFix | null>(null);
  const [applied, setApplied] = useState<AppliedFix | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const quickFix = useMermaidQuickFix({ projectId });
  const parts = useMemo(() => segments(content), [content]);

  const save = useCallback(
    async (next: string): Promise<boolean> => {
      setSaving(true);
      try {
        await putWikiPage(projectId, pageKey, next);
        setContent(next);
        // The page query holds the fetched text; without this a reload of
        // the same wiki would show the pre-fix content until the cache aged.
        void queryClient.invalidateQueries({ queryKey: ['deepwiki', 'page'] });
        return true;
      } catch (error) {
        setFeedback({
          kind: 'error',
          text: t('deepwiki.fix.saveFailed', 'The page could not be saved: {{reason}}', {
            reason: error instanceof Error ? error.message : 'unknown error',
          }),
        });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [pageKey, projectId, queryClient],
  );

  const accept = useCallback(async () => {
    if (pending === null) return;
    const previous = content;
    const next = replaceMermaidBlock(content, pending.blockIndex, pending.fixed);
    if (await save(next)) {
      setApplied({ previous });
      setPending(null);
      setFeedback({ kind: 'success', text: t('deepwiki.fix.applied', 'Diagram fixed and saved.') });
    }
  }, [content, pending, save]);

  const undo = useCallback(async () => {
    if (applied === null) return;
    if (await save(applied.previous)) {
      setApplied(null);
      setFeedback({ kind: 'success', text: t('deepwiki.fix.undone', 'The fix was undone and the page saved.') });
    }
  }, [applied, save]);

  const pendingDiff = useMemo(() => {
    if (pending === null) return null;
    const current = extractMermaidBlocks(content)[pending.blockIndex]?.code ?? '';
    return lineDiff(current, pending.fixed);
  }, [content, pending]);

  return (
    <Box data-testid="wiki-page-reader">
      {feedback === null ? null : (
        <Alert
          severity={feedback.kind}
          onClose={() => {
            setFeedback(null);
          }}
          sx={{ mb: 1 }}
          data-testid="wiki-page-feedback"
        >
          {feedback.text}
        </Alert>
      )}

      {applied === null ? null : (
        <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="bodySmall" color="text.secondary">
            {t('deepwiki.fix.appliedNote', 'A diagram fix has been applied to this page.')}
          </Typography>
          <Button size="small" onClick={() => void undo()} disabled={saving} data-testid="wiki-fix-undo">
            {t('deepwiki.fix.undo', 'Undo fix')}
          </Button>
        </Stack>
      )}

      {parts.map((part, position) =>
        part.kind === 'text' ? (
          // Segments have no identity of their own; a page is re-split on every
          // change and position is what distinguishes two identical runs.
          // eslint-disable-next-line react/no-array-index-key -- see above
          <Markdown key={`text-${String(position)}`}>{part.text}</Markdown>
        ) : (
          <Box key={`mermaid-${String(part.index)}`} data-testid="wiki-mermaid-block" sx={{ my: 1 }}>
            <MermaidDiagram
              code={part.text}
              onError={(summary) => {
                setErrors((previous) =>
                  previous[part.index] === summary ? previous : { ...previous, [part.index]: summary },
                );
              }}
            />
            {(errors[part.index] ?? '') !== '' ? (
              <MermaidQuickFixButton
                quickFix={quickFix}
                error={errors[part.index]}
                code={part.text}
                onFixed={(fixed) => {
                  setPending({ blockIndex: part.index, fixed });
                }}
                onError={(error) => {
                  setFeedback({
                    kind: 'error',
                    text: error instanceof Error ? error.message : String(error),
                  });
                }}
              />
            ) : null}
          </Box>
        ),
      )}

      <Dialog open={pending !== null} onClose={() => { setPending(null); }} maxWidth="md" fullWidth>
        <DialogTitle>{t('deepwiki.fix.reviewTitle', 'Review the proposed fix')}</DialogTitle>
        <DialogContent>
          {pendingDiff === null ? null : <DiffView parts={pendingDiff} data-testid="wiki-fix-diff" />}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setPending(null); }} data-testid="wiki-fix-reject">
            {t('deepwiki.fix.reject', 'Discard')}
          </Button>
          <Button variant="contained" onClick={() => void accept()} disabled={saving} data-testid="wiki-fix-accept">
            {t('deepwiki.fix.accept', 'Accept and save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
