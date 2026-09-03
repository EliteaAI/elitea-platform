/**
 * The DeepWiki chat drawer — the composition root for the wiki conversation.
 *
 * WHY A WIDGET. `features/wiki-chat` is headless: it owns the conversation and
 * nothing that renders. This layer is where the pieces meet, and it is the ONLY
 * layer allowed to reach into `features/chat-messages` — `no-sideways-features`
 * exempts that slice FROM the rule, not TO it, so a feature cannot import it and
 * a widget can. (This first pass reuses `shared/ui/Markdown` and needs nothing
 * from that slice yet; the permission is the reason the drawer lives here.)
 *
 * IT OWNS NO CONVERSATION STATE. Everything below is derived from the
 * controller. A second copy here — a `messages` mirror, a cached `isLoading` —
 * is how the drawer and the stream come to disagree about whether a turn is
 * still running.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { ResizableDrawer } from '@/shared/ui/ResizableDrawer';
import { isThinkingBlock, useWikiChat } from '@/features/wiki-chat';

import { pollWikiChat, startWikiChat, type WikiChatTarget } from '../api/wikiChatApi';
import { createWikiChatStorage } from '../lib/chatStorage';
import { ResearchTodosPanel } from './ResearchTodosPanel';
import { WikiChatComposer } from './WikiChatComposer';
import { WikiChatMessages } from './WikiChatMessages';

/**
 * Resize bounds in CSS pixels: ResizableDrawer measures the pointer, so its
 * arithmetic is px by nature (the same reason sidebarWidth.ts exports a px
 * value beside its rem one). 480px is the 30rem the app's other right-hand
 * surfaces open at.
 */
const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 352;
const MAX_WIDTH = 800;

export interface WikiChatDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly target: WikiChatTarget;
  /**
   * The open wiki version's page ids, offered as attachable context. They come
   * from the manifest the page already has open, so the picker can only offer
   * what the provider will accept for that version.
   */
  readonly contextPages?: readonly string[];
  /** A fresh identifier. Injected so a test can make ids predictable. */
  readonly newId?: () => string;
}

export const WikiChatDrawer = memo(function WikiChatDrawer({
  open,
  onClose,
  target,
  contextPages,
  newId,
}: WikiChatDrawerProps) {
  /**
   * The attachment lives HERE, not in the conversation state.
   *
   * It is a property of the next question, not of a turn already sent, and the
   * controller is deliberately headless — threading a selection through it
   * would put a rendering concern into a slice that has none. The consequence
   * is that `regenerate` re-asks with whatever is attached NOW, which is what
   * the control on screen says it will do.
   */
  const [contextPaths, setContextPaths] = useState<readonly string[]>([]);
  const storage = useMemo(
    () => createWikiChatStorage(target.projectId, target.toolkitId),
    [target.projectId, target.toolkitId],
  );

  // The selection is folded into the target rather than into the controller's
  // input, so `features/wiki-chat` needs no knowledge of attachments at all.
  const attaching = useMemo(
    () => ({ ...target, contextPaths }),
    [target, contextPaths],
  );

  const onContextPathsChange = useCallback((selected: readonly string[]) => {
    setContextPaths(selected);
  }, []);

  const chat = useWikiChat({
    invoke: (input) => startWikiChat(attaching, input),
    // The tool name is carried on the state's own pending turn rather than
    // recomputed from the mode: the mode can move while a turn is in flight,
    // and polling the wrong tool's path returns a 404 that reads as a lost
    // invocation.
    poll: (invocationId) =>
      pollWikiChat(target, chat.state.pendingCapability === 'research' ? 'deep_research' : 'ask', invocationId),
    storage,
    newId: newId ?? (() => crypto.randomUUID()),
  });

  // Opening restores the capability the LAST ANSWER was produced with, which is
  // not necessarily the toggle's last position — see `capabilityOnOpen`.
  useEffect(() => {
    if (open) chat.restoreCapability();
    // Only on the open transition. Depending on the controller would re-run it
    // after every frame and fight the user's own toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [open]);

  const canRegenerate = useMemo(
    () => chat.state.messages.some((message) => !isThinkingBlock(message) && message.role === 'user'),
    [chat.state.messages],
  );

  return (
    <ResizableDrawer
      open={open}
      onClose={onClose}
      initialWidth={DEFAULT_WIDTH}
      minWidth={MIN_WIDTH}
      maxWidth={MAX_WIDTH}
      aria-label={t('widgets.deepwiki.chat.title', 'Wiki chat')}
      data-testid="wiki-chat-drawer"
    >
      <Stack
        sx={{ flexDirection: 'row', alignItems: 'center', p: 1.5, borderBottom: 1, borderColor: 'divider' }}
      >
        <Typography variant="headingSmall" sx={{ flex: 1 }}>
          {t('widgets.deepwiki.chat.title', 'Wiki chat')}
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label={t('widgets.deepwiki.chat.close', 'Close')}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      <ResearchTodosPanel todos={chat.state.todos} />

      {chat.state.messages.length === 0 && chat.state.streamingText === '' ? (
        <Box sx={{ p: 2, flex: 1 }}>
          <Typography variant="bodyMedium" color="text.secondary">
            {t(
              'widgets.deepwiki.chat.empty',
              'Ask a question about this repository, or switch to Research for a longer investigation.',
            )}
          </Typography>
        </Box>
      ) : (
        <WikiChatMessages
          messages={chat.state.messages}
          streamingText={chat.state.streamingText}
        />
      )}

      {/* The error is shown ALONGSIDE the failed turn, not instead of it. The
          turn already carries the message; this banner is what makes a failure
          visible when the list is scrolled away from it. */}
      {chat.state.error ? (
        <Alert severity="error" variant="outlined" sx={{ mx: 1.5 }} data-testid="wiki-chat-error">
          {chat.state.error}
        </Alert>
      ) : null}

      <WikiChatComposer
        mode={chat.state.mode}
        onModeChange={chat.setMode}
        onSend={chat.send}
        onRegenerate={chat.regenerate}
        onClear={chat.clear}
        isLoading={chat.state.isLoading}
        canRegenerate={canRegenerate}
        contextPages={contextPages ?? []}
        contextPaths={contextPaths}
        onContextPathsChange={onContextPathsChange}
      />
    </ResizableDrawer>
  );
});
