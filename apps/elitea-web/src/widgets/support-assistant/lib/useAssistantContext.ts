/**
 * useAssistantContext — the page context sent with every support question.
 *
 * The reference builds this in `EliteaUI`'s
 * `widgets/support-assistant/lib/hooks/useAssistantContext.hooks.js`, reading
 * Redux for the current project, page type, entity and selected model, and ships
 * it as `support_assistant_context` on the socket payload. The shape is fixed by
 * the server: `legacy/plugins/support_assistant/models/pd/support.py`'s
 * `SupportAssistantContext`, which `internal/api/v2/supportassistant` ports field
 * for field.
 *
 * IT IS THE WHOLE POINT OF AN IN-APP ASSISTANT. A support chat that does not
 * know which screen the user is on is a search box; this is what lets the agent
 * answer "why is this failing?" without the user first explaining where "this"
 * is.
 *
 * # What is derived, and what is honestly absent
 *
 * The route is the source of truth for the page and the entity, because this app
 * routes on the entity id (`/agents/$tab/$agentId`) — so the derivation is a URL
 * read rather than a subscription to five feature stores.
 *
 * `current_entity_name`, `selected_provider` and `selected_model` are NOT SENT.
 * The reference reads them from Redux slices this app has no equivalent of at
 * the shell level, and the alternative — this widget subscribing to the agent,
 * toolkit and chat-model stores to fill three optional strings — would couple a
 * floating widget to half the app's feature slices. Every field is optional on
 * the wire, and an absent one is absent rather than guessed.
 */
import { useMemo } from 'react';

import { useRouterState } from '@tanstack/react-router';

import type { TSupportAssistantContext } from '../vendor/lib/types';

/** The project the shell has selected, passed in rather than read here — see below. */
export interface AssistantContextProject {
  readonly id?: string | number | undefined;
  readonly name?: string | undefined;
}

/**
 * The first path segment that names an entity KIND, mapped to the singular noun
 * the reference uses. A segment not in this map contributes no entity type,
 * which is the accurate answer for a listing or a settings page.
 */
const ENTITY_TYPE_BY_SEGMENT: Readonly<Record<string, string>> = {
  agents: 'agent',
  pipelines: 'pipeline',
  skills: 'skill',
  toolkits: 'toolkit',
  mcps: 'mcp',
  artifacts: 'artifact',
  credentials: 'credential',
  apps: 'application',
  chat: 'conversation',
};

/**
 * Derive `{ current_page, current_entity_type, current_entity_id }` from a
 * pathname.
 *
 * The entity id is the LAST NUMERIC SEGMENT, not the second one. This app's
 * entity routes interpose a tab (`/agents/configuration/42`,
 * `/toolkits/settings/7`), so "the segment after the kind" is the tab name on
 * every one of them. A path with no numeric segment names no entity — a listing,
 * a create form — and reports none.
 */
export function deriveAssistantPageContext(pathname: string): {
  current_page: string;
  current_entity_type?: string;
  current_entity_id?: number;
} {
  const segments = pathname.split('/').filter(Boolean);
  const [kind] = segments;
  const entityType = kind !== undefined ? ENTITY_TYPE_BY_SEGMENT[kind] : undefined;

  let entityId: number | undefined;
  for (let index = segments.length - 1; index >= 1; index -= 1) {
    const segment = segments[index];
    if (segment !== undefined && /^\d+$/.test(segment)) {
      entityId = Number(segment);
      break;
    }
  }

  return {
    current_page: pathname,
    // `exactOptionalPropertyTypes`: an absent field is an ABSENT KEY, not a key
    // holding `undefined`, so that `JSON.stringify` omits it and the agent sees
    // "not on an entity page" rather than `"current_entity_type": null`.
    ...(entityType !== undefined ? { current_entity_type: entityType } : {}),
    ...(entityId !== undefined ? { current_entity_id: entityId } : {}),
  };
}

/** Build the context payload for the current route and project. */
export function useAssistantContext(project?: AssistantContextProject): TSupportAssistantContext {
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });
  const projectId = project?.id;
  const projectName = project?.name;

  return useMemo(() => {
    const numericProjectId = projectId === undefined ? undefined : Number(projectId);
    return {
      ...deriveAssistantPageContext(pathname),
      ...(numericProjectId !== undefined && Number.isFinite(numericProjectId)
        ? { project_id: numericProjectId }
        : {}),
      ...(projectName !== undefined && projectName !== '' ? { project_name: projectName } : {}),
    };
  }, [pathname, projectId, projectName]);
}
