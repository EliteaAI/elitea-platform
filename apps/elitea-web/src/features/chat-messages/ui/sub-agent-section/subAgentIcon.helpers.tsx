/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/ui/sub-agent-section/
 * subAgentIcon.helpers.jsx` — icon resolution for sub-agents.
 *
 * Resolves the appropriate icon for a sub-agent based on its name, tools,
 * and agent type (application vs pipeline).
 *
 * Port of `apps/elitea-ui/src/[fsd]/features/chat/ui/sub-agent-section/
 * subAgentIcon.helpers.jsx`.
 */
import type { Theme } from '@mui/material/styles';

import { ApplicationsIcon } from '@/shared/ui/icons/applications-icon';
import { FlowIcon } from '@/shared/ui/icons/flow-icon';
import { ToolIcon } from '@/shared/ui/icons/tool-icon';

/** @public Sub-agent tool entry. */
export interface SubAgentTool {
  readonly name?: string;
  readonly toolkit_name?: string;
  readonly meta?: { readonly name?: string };
  readonly type?: string;
  readonly entity_settings?: { readonly toolkit_type?: string };
  readonly agent_type?: string;
  readonly icon_meta?: { readonly url?: string };
}

/**
 * `resolveSubAgentIcon` — resolves the appropriate icon component and
 * sx props for a sub-agent based on its name, tools array, and agent type.
 *
 * Mirrors how `ActionView.renderIcon` picks an icon in the old app —
 * custom icon_meta image for app/pipeline, else type icon.
 */
export function resolveSubAgentIcon(
  name: string,
  tools: readonly SubAgentTool[] | undefined,
  _theme: Theme,
  agentType?: string,
): { component: React.ComponentType; sx: Record<string, unknown> } | undefined {
  if (!name) return undefined;

  const tool = tools?.find(
    (t) =>
      t?.name === name ||
      t?.toolkit_name === name ||
      t?.meta?.name?.replace('/', '') === name,
  );

  // Determine type from agentType prop or tool metadata.
  let type = '';
  if (agentType) {
    type = agentType === 'pipeline' ? 'pipeline' : 'application';
  } else if (tool?.agent_type) {
    type = tool.agent_type === 'pipeline' ? 'pipeline' : 'application';
  } else {
    type = tool?.type || tool?.entity_settings?.toolkit_type || '';
  }

  const iconMeta = tool?.icon_meta;
  if (iconMeta?.url && (type === 'application' || type === 'pipeline')) {
    return {
      component: () => null, // Custom icon from URL handled separately
      sx: {
        width: '1rem',
        height: '1rem',
        borderRadius: '50%',
        overflow: 'hidden',
        flexShrink: 0,
      },
    };
  }

  if (type === 'pipeline') {
    return { component: FlowIcon, sx: { width: '1rem', height: '1rem', flexShrink: 0 } };
  }
  if (type === 'application') {
    return { component: ApplicationsIcon, sx: { width: '1rem', height: '1rem', flexShrink: 0 } };
  }

  // Default fallback.
  return { component: ToolIcon, sx: { width: '1rem', height: '1rem', flexShrink: 0 } };
}
