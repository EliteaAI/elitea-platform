/**
 * The composer "+" menu's data, in the shape `PlusChatButton` consumes.
 *
 * `useChatEntityBrowser` has existed (with its own tests) since the Wave-2
 * cluster landed, and its module header says a "future widget/feature that
 * renders the actual submenu component composes this hook's plain data with
 * its own click handlers". That composition is this file — it was the missing
 * link between a built data layer and a built menu widget, neither of which
 * had a caller.
 *
 * **Where this lives and why.** `useChatEntityBrowser` is in
 * `processes/chat/model`, and `widgets/` may not import `processes/`
 * (`no-upward-from-widgets`, `.dependency-cruiser.cjs`). So the fetch has to
 * happen at or above `processes/`, and the resolved lists are handed DOWN as
 * a prop — `ChatWithEditors` -> `ChatPage` -> `ChatBox` -> the "+" menu.
 *
 * **The fetch is gated on the menu having been opened** (`enabled`). Four
 * participant queries per chat load, for a menu most sessions never open, is
 * the cost `useChatEntityBrowser`'s own `skip` parameter exists to avoid —
 * and the baseline gates the same fetches behind its own `hasBeenOpenedRef`.
 * Once opened, the gate stays open for the rest of the session so reopening
 * the menu is instant rather than re-showing a spinner.
 *
 * **What is NOT wired, stated rather than faked:**
 *  - Per-submenu SEARCH. `useChatEntityBrowser` takes one query string per
 *    bucket, but `PlusChatButton` owns its search box locally and filters the
 *    items it was given client-side. That is correct for a loaded page and
 *    wrong for a project with more entities than the backend's page cap
 *    (20/50/100 rows — see `useChatEntityBrowser`'s own disclosure); typing
 *    past the cap finds nothing rather than fetching. Closing that needs the
 *    query to travel UP from the widget, which is a prop-contract change.
 *  - "Create new" in each submenu. It needs a blank agent/pipeline/toolkit
 *    editor, and `useChatWithEditors` only opens editors for an EXISTING
 *    participant. No `onCreate*` handler is passed, and
 *    `resolveSubmenuCreateConfig` now hides the row when there is none, so
 *    the menu shows no control it cannot honour.
 *
 * **Why the rows are flattened here.** `useChatEntityBrowser` returns
 * `ParticipantEntityItem`s — `{label, participantType, isPublic, data}`, with
 * the real `id`/`name` one level down in `data`. `PlusChatButton`'s
 * `toEntityItems` reads `item.id`/`item.name` directly, so handing it those
 * items unchanged would have labelled every row "Pipeline 1", "Pipeline 2",
 * … and passed a wrapper object to the select handler. `toPlusMenuItem`
 * below is the same flattening `features/chat-recommendations`'
 * `toCandidateRecommendationItem` already applies on the recommendation
 * path, which is what makes the object it produces the shape
 * `onChangeParticipant` — the SAME callback both paths end in — already
 * accepts. Replicated rather than imported: it is not exported from that
 * feature's barrel, and the `RecommendationItem` type that IS exported keeps
 * this typed against the real contract instead of `unknown`.
 */
import { useCallback, useMemo, useState } from 'react';

import type { ParticipantEntityItem } from '@/entities/participant';
import type { RecommendationItem } from '@/features/chat-recommendations';
import { useSelectedProject } from '@/widgets/app-shell';

import { useChatEntityBrowser } from './useChatEntityBrowser';

/** Raw wire row read off `ParticipantEntityItem.data` — the structural subset this mapping needs. */
interface CandidateWireRow {
  readonly id?: unknown;
  readonly description?: unknown;
  readonly type?: unknown;
}

/** @public (test seam) See this module's header: `ParticipantEntityItem` -> the flat row the "+" menu labels and the participant handlers consume. */
export function toPlusMenuItem(item: ParticipantEntityItem, projectId: string | undefined): RecommendationItem {
  const row = item.data as CandidateWireRow;
  const id = typeof row.id === 'string' ? row.id : item.label;
  const description = typeof row.description === 'string' ? row.description : undefined;
  const type = typeof row.type === 'string' ? row.type : undefined;
  return {
    id,
    name: item.label,
    ...(description !== undefined ? { description } : {}),
    participantType: item.participantType,
    ...(type !== undefined ? { type } : {}),
    ...(projectId !== undefined ? { project_id: projectId } : {}),
  };
}

/** Mirrors `widgets/chat`'s `PlusChatButtonEntitySubmenus` without importing it (a `widgets/` type in a `processes/` model file is legal, but this stays structural to keep the model layer JSX/widget-free). */
export interface PlusMenuEntities {
  readonly pipelines: readonly unknown[];
  readonly toolkits: readonly unknown[];
  readonly mcps: readonly unknown[];
}

export interface UsePlusMenuEntitiesResult {
  readonly entities: PlusMenuEntities;
  /** Call when the menu opens; the first call starts the fetches. */
  readonly onOpen: () => void;
}

export function usePlusMenuEntities(): UsePlusMenuEntitiesResult {
  const { project } = useSelectedProject();
  const projectId = project?.id === undefined ? undefined : String(project.id);
  const [hasOpened, setHasOpened] = useState(false);
  const onOpen = useCallback(() => { setHasOpened(true); }, []);

  const browser = useChatEntityBrowser({
    projectId,
    publicProjectId: String(import.meta.env?.VITE_PUBLIC_PROJECT_ID ?? ''),
    canListPublicAgents: true,
    skip: !hasOpened,
  });

  const entities = useMemo(
    () => ({
      pipelines: browser.pipelines.items.map((item) => toPlusMenuItem(item, projectId)),
      toolkits: browser.toolkits.items.map((item) => toPlusMenuItem(item, projectId)),
      mcps: browser.mcps.items.map((item) => toPlusMenuItem(item, projectId)),
    }),
    [browser.pipelines.items, browser.toolkits.items, browser.mcps.items, projectId],
  );

  return { entities, onOpen };
}
