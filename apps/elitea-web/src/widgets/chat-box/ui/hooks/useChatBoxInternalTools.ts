/**
 * Split out of `ChatBox.tsx` to stay under the file-length/component-props
 * budgets (§3.5) — real internal-tools-config persistence.
 * `processes/chat/model/useInternalToolsConfig.ts` cannot be imported here
 * — `widgets/` may not import `processes/` (`no-upward-from-widgets`,
 * `.dependency-cruiser.cjs`) — so its small optimistic-update-then-PUT
 * logic is reproduced locally against the same `conversationApi.useEdit()`
 * mutation it itself uses, rather than duplicating a whole new endpoint.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { conversationApi } from '@/entities/conversation';
import { agentEditorHooks } from '@/features/agents';

import { optField } from '../ChatBox.helpers';

type InternalToolsConversationSnapshot = {
  readonly id: string | number;
  readonly meta?: Readonly<Record<string, unknown>> & { readonly internal_tools?: readonly string[] };
};

export interface UseChatBoxInternalToolsParams {
  readonly conversationId: string | number | undefined;
  readonly conversationMeta: Readonly<Record<string, unknown>> | undefined;
  readonly projectId: string | number | undefined;
  readonly isAgentsPage: boolean | undefined;
}

export interface UseChatBoxInternalToolsResult {
  readonly internalToolsButtonTools: readonly { readonly key: string; readonly label: string; readonly enabled: boolean }[];
  readonly handleInternalToolChange: (toolKey: string, enabled: boolean) => void;
  readonly isUpdatingInternalToolsConfig: boolean;
}

export function useChatBoxInternalTools({
  conversationId,
  conversationMeta,
  projectId,
  isAgentsPage,
}: UseChatBoxInternalToolsParams): UseChatBoxInternalToolsResult {
  const { mutateAsync: editConversationMutateAsync, isPending: isUpdatingInternalToolsConfig } = conversationApi.useEdit();

  const snapshotInternalToolsConversation = useCallback((): InternalToolsConversationSnapshot | undefined => {
    if (conversationId === undefined) return undefined;
    return { id: conversationId, ...optField('meta', conversationMeta) };
  }, [conversationId, conversationMeta]);
  const [internalToolsConversation, setInternalToolsConversation] = useState<InternalToolsConversationSnapshot | undefined>(snapshotInternalToolsConversation);
  useEffect(() => {
    setInternalToolsConversation(snapshotInternalToolsConversation());
  }, [snapshotInternalToolsConversation]);

  const onInternalToolsConfigChange = useCallback(
    async (input: { readonly key: string; readonly value: boolean }) => {
      const conv = internalToolsConversation;
      if (!conv || projectId === undefined) return;
      const previousMeta = conv.meta;
      const previousTools = previousMeta?.internal_tools ?? [];
      const newTools = input.value ? [...previousTools, input.key] : previousTools.filter((t) => t !== input.key);
      const newMeta = { ...previousMeta, internal_tools: newTools };
      setInternalToolsConversation((prev) => (prev ? { ...prev, meta: newMeta } : prev));
      try {
        await editConversationMutateAsync({ projectId, id: conv.id, meta: newMeta });
      } catch {
        setInternalToolsConversation((prev) => (prev ? { ...prev, meta: previousMeta ?? {} } : prev));
      }
    },
    [internalToolsConversation, projectId, editConversationMutateAsync],
  );

  const availableInternalTools = agentEditorHooks.useAvailableInternalTools({ includeAgentOnly: !!isAgentsPage });
  const internalToolsButtonTools = useMemo(
    () =>
      availableInternalTools.map((tool) => ({
        key: tool.name,
        label: tool.title,
        enabled: (internalToolsConversation?.meta?.internal_tools ?? []).includes(tool.name),
      })),
    [availableInternalTools, internalToolsConversation?.meta],
  );

  const handleInternalToolChange = useCallback(
    (toolKey: string, enabled: boolean) => { void onInternalToolsConfigChange({ key: toolKey, value: enabled }); },
    [onInternalToolsConfigChange],
  );

  return { internalToolsButtonTools, handleInternalToolChange, isUpdatingInternalToolsConfig };
}
