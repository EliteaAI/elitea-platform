// @ts-nocheck
import { useMemo } from 'react';

import { useTheme } from '@mui/material/styles';

import { ChatParticipantType } from '../../model/constants';
import type { ParticipantIconMeta } from '../../model/types';

/**
 * Hook that resolves the icon for a chat participant.
 *
 * HIGH RISK — ported from `useParticipantEntityIcon.hooks.js` which called
 * `ToolkitsHelpers.getToolkitIcon()` and `useGetCurrentToolkitSchemas()` from
 * `features/toolkits` (illegal cross-feature import). The new-app port uses a
 * **slot-based approach**: the caller supplies an optional `resolveToolkitIcon`
 * callback, and falls back to the entity-type icon from `entities/toolkit`
 * or a default icon.
 *
 * If no slot is provided, falls back to the generic `EntityTypeIcon` for
 * toolkit participants. This is the same pattern established by
 * `ToolCard.types.ts`'s `ToolCardIcon` prop.
 */
export interface UseParticipantEntityIconOptions {
  /** Optional slot to resolve toolkit icon details. When provided, called with toolkit type, theme, and MCP flag. */
  resolveToolkitIcon?: (
    toolkitType: string,
    theme: unknown,
    mcp?: boolean,
  ) => Pick<ParticipantIconMeta, 'component' | 'url'>;
}

export interface ParticipantEntityIconResult extends ParticipantIconMeta {
  /** The entity type used for rendering the icon (derived from participant data). */
  readonly entityType?: string;
}

// ---------------------------------------------------------------------------
// Helper: extract non-toolkit icon (complexity ≤ 3)
// ---------------------------------------------------------------------------

function resolveNonToolkitIcon(
  participant: Record<string, unknown>,
  type: ChatParticipantType,
): ParticipantEntityIconResult {
  const iconMeta =
    participant.entity_settings?.icon_meta ||
    participant.icon_meta ||
    participant.version_details?.icon_meta;

  if (iconMeta && typeof iconMeta === 'object') {
    return {
      ...iconMeta,
      entityType: type,
    };
  }
  return { entityType: type };
}

// ---------------------------------------------------------------------------
// Helper: resolve toolkit icon with slot (complexity ≤ 2)
// ---------------------------------------------------------------------------

function resolveToolkitWithSlot(
  participant: Record<string, unknown>,
  toolkitType: string,
  theme: unknown,
  isMCP: boolean | undefined,
  resolveToolkitIcon: UseParticipantEntityIconOptions['resolveToolkitIcon'],
): ParticipantEntityIconResult {
  const resolved = resolveToolkitIcon(toolkitType, theme, isMCP);
  const iconMeta = participant.entity_settings?.icon_meta;
  const base = (typeof iconMeta === 'object' && iconMeta !== null)
    ? { ...iconMeta }
    : {};
  return {
    ...base,
    ...resolved,
    entityType: isMCP ? 'mcp' : (participant.entity_name as ChatParticipantType),
  };
}

// ---------------------------------------------------------------------------
// Helper: resolve toolkit icon without slot (complexity ≤ 1)
// ---------------------------------------------------------------------------

function resolveToolkitWithoutSlot(
  participant: Record<string, unknown>,
  isMCP: boolean | undefined,
  type: ChatParticipantType,
): ParticipantEntityIconResult {
  const iconMeta = participant.entity_settings?.icon_meta;
  const base = (typeof iconMeta === 'object' && iconMeta !== null)
    ? { ...iconMeta }
    : {};
  return {
    ...base,
    entityType: isMCP ? 'mcp' : type,
  };
}

export function useParticipantEntityIcon(
  participant: Record<string, unknown> | undefined,
  options: UseParticipantEntityIconOptions = {},
): ParticipantEntityIconResult {
  const theme = useTheme();
  const { resolveToolkitIcon } = options;

  const entityIcon = useMemo(() => {
    if (!participant?.entity_name) {
      return {
        url: undefined,
        entityType: ChatParticipantType.Dummy,
      };
    }

    const type = participant.entity_name as ChatParticipantType;
    const participantType = participant.participantType as ChatParticipantType | undefined;
    const isToolkit = type === ChatParticipantType.Toolkits || participantType === ChatParticipantType.Toolkits;

    if (!isToolkit) {
      return resolveNonToolkitIcon(participant, type);
    }

    const toolkitType =
      participant.entity_settings?.toolkit_type ||
      participant.type ||
      '';
    const isMCP = participant.meta?.mcp as boolean | undefined;

    if (resolveToolkitIcon) {
      return resolveToolkitWithSlot(participant, toolkitType, theme, isMCP, resolveToolkitIcon);
    }

    return resolveToolkitWithoutSlot(participant, isMCP, type);
  }, [participant, resolveToolkitIcon, theme]);

  return entityIcon;
}
