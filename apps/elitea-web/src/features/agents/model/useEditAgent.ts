import { useCallback, useEffect, useRef, useState } from 'react';

import { syncVariableKeys, type AgentVariable } from '../lib/syncVariableKeys';

/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useEditAgent.js`.
 *
 * **DISCLOSED DESIGN DEVIATION — nav-blocker dependency injection, same
 * rationale as `useAgentEditorUrlSync.ts`'s own doc comment.** The baseline
 * reads `isEditingAgent`/`setAgentEditingBlockNav` off `useNavBlocker()`
 * (a Redux hook). This app's nav-blocker equivalent —
 * `widgets/app-shell/model/navBlocker.store.ts` — lives in `widgets/`,
 * strictly above `features/` (spec §3.2); importing it here is the exact
 * upward import that store's own doc comment already flags as blocked for
 * "any `features/*` unit [that] needs to set it". `isEditingAgent` (read)
 * and `setAgentEditingBlockNav` (write) are therefore injected params —
 * the caller (composed at a page/widget layer that CAN see both this hook
 * and the nav-blocker store) wires the real store in.
 */

interface AgentEditingNavBlocker {
  readonly isEditingAgent: boolean;
  readonly setAgentEditingBlockNav: (blocked: boolean) => void;
}

export interface EditAgentParticipantSettings {
  readonly variables?: readonly AgentVariable[] | undefined;
  readonly version_id?: string | number | undefined;
  readonly llm_settings?: unknown;
}

export interface EditAgentParticipant {
  readonly id?: string | number;
  readonly entity_meta?: { readonly id?: string | number };
  readonly entity_settings?: EditAgentParticipantSettings;
}

export interface SavedAgentData {
  readonly id?: string | number;
  readonly version_details?: {
    readonly id?: string | number;
    readonly variables?: readonly AgentVariable[];
    readonly llm_settings?: unknown;
  };
}

export interface UseEditAgentParams {
  readonly activeParticipant?: EditAgentParticipant | null;
  readonly setActiveParticipant?: (
    updater: (prev: EditAgentParticipant | null | undefined) => EditAgentParticipant | null | undefined,
  ) => void;
  readonly onChangeParticipantSettings?: (participant: EditAgentParticipant, persist: boolean) => void;
  readonly navBlocker: AgentEditingNavBlocker;
}

/**
 * The variable-sync/field-merge half of `handleAgentSaved`
 * (`useEditAgent.js:81-96`), extracted purely to keep that callback under
 * the cyclomatic-complexity budget — the optional-chaining-heavy field
 * merge alone accounts for most of it.
 */
function buildRefreshedParticipant(
  activeParticipant: EditAgentParticipant,
  savedData: SavedAgentData,
): EditAgentParticipant {
  const currentParticipantVariables = activeParticipant.entity_settings?.variables ?? [];
  const agentVariables = savedData.version_details?.variables ?? [];
  const syncedKeysVariables = syncVariableKeys(agentVariables, currentParticipantVariables);

  return {
    ...activeParticipant,
    entity_settings: {
      ...activeParticipant.entity_settings,
      variables: syncedKeysVariables,
      version_id: savedData.version_details?.id ?? activeParticipant.entity_settings?.version_id,
      llm_settings: savedData.version_details?.llm_settings,
    },
  };
}

export interface UseEditAgentResult {
  readonly isEditingAgent: boolean;
  readonly editingAgent: EditAgentParticipant | null;
  readonly isCreateMode: boolean;
  readonly onShowAgentEditor: (participant: EditAgentParticipant) => void;
  readonly onShowAgentEditorCreator: () => void;
  readonly onAgentEditorCreated: (createdAgent: EditAgentParticipant) => void;
  readonly onCloseAgentEditor: () => void;
  readonly handleAgentSaved: (savedData: SavedAgentData) => void;
}

/** Hook for managing agent editing state in chat — same public contract as the baseline. */
export function useEditAgent({
  activeParticipant,
  setActiveParticipant,
  onChangeParticipantSettings,
  navBlocker,
}: UseEditAgentParams): UseEditAgentResult {
  const { isEditingAgent, setAgentEditingBlockNav } = navBlocker;
  const setAgentEditingBlockNavRef = useRef(setAgentEditingBlockNav);

  useEffect(() => {
    setAgentEditingBlockNavRef.current = setAgentEditingBlockNav;
  }, [setAgentEditingBlockNav]);

  const [editingAgent, setEditingAgent] = useState<EditAgentParticipant | null>(null);
  const [isCreateMode, setIsCreateMode] = useState(false);

  useEffect(() => {
    if (
      isEditingAgent &&
      !isCreateMode &&
      editingAgent &&
      activeParticipant &&
      editingAgent.id === activeParticipant.id
    ) {
      setEditingAgent(activeParticipant);
    }
    // oxlint-disable-next-line react/exhaustive-deps -- mirrors the baseline's own deliberately-scoped dependency list (`useEditAgent.js:26-37`).
  }, [activeParticipant, isEditingAgent, isCreateMode, editingAgent?.id]);

  const onShowAgentEditor = useCallback((theSelectedParticipant: EditAgentParticipant) => {
    if (!theSelectedParticipant) return;
    setEditingAgent(theSelectedParticipant);
    setIsCreateMode(false);
    setAgentEditingBlockNavRef.current(true);
  }, []);

  const onCloseAgentEditor = useCallback(() => {
    setAgentEditingBlockNavRef.current(false);
    setEditingAgent(null);
    setIsCreateMode(false);
  }, []);

  const handleAgentSaved = useCallback(
    (savedData: SavedAgentData) => {
      if (!savedData || !activeParticipant || !setActiveParticipant) return;
      if (activeParticipant.entity_meta?.id !== savedData.id) return;

      const refreshedParticipant = buildRefreshedParticipant(activeParticipant, savedData);
      setActiveParticipant((prev) => (prev?.id === refreshedParticipant.id ? refreshedParticipant : prev));
      onChangeParticipantSettings?.(refreshedParticipant, true);
    },
    [activeParticipant, setActiveParticipant, onChangeParticipantSettings],
  );

  const onShowAgentEditorCreator = useCallback(() => {
    setEditingAgent(null);
    setIsCreateMode(true);
    setAgentEditingBlockNavRef.current(true);
  }, []);

  const onAgentEditorCreated = useCallback((createdAgent: EditAgentParticipant) => {
    setEditingAgent(createdAgent);
    setIsCreateMode(false);
  }, []);

  useEffect(() => {
    return () => {
      setAgentEditingBlockNavRef.current(false);
    };
  }, []);

  return {
    isEditingAgent,
    editingAgent,
    isCreateMode,
    onShowAgentEditor,
    onShowAgentEditorCreator,
    onAgentEditorCreated,
    onCloseAgentEditor,
    handleAgentSaved,
  };
}
