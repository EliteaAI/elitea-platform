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

    // Non-toolkit participants: return their existing icon_meta if present
    if (type !== ChatParticipantType.Toolkits && participantType !== ChatParticipantType.Toolkits) {
      const iconMeta =
        (participant.entity_settings as Record<string, unknown>)?.icon_meta ||
        (participant.icon_meta as Record<string, unknown>) ||
        (participant.version_details as Record<string, unknown>)?.icon_meta;
      if (iconMeta && typeof iconMeta === 'object') {
        return {
          ...(iconMeta as Record<string, unknown>),
          entityType: type,
        };
      }
      return { entityType: type };
    }

    // Toolkit participants: resolve via slot or fall back to generic entity icon
    const toolkitType =
      (participant.entity_settings as Record<string, unknown>)?.toolkit_type ||
      (participant.type as string) ||
      '';
    const isMCP = (participant.meta as Record<string, unknown>)?.mcp as boolean | undefined;

    if (resolveToolkitIcon) {
      const resolved = resolveToolkitIcon(toolkitType, theme, isMCP);
      return {
        ...(participant.entity_settings as Record<string, unknown>)?.icon_meta,
        ...resolved,
        entityType: isMCP ? 'mcp' : type,
      };
    }

    // No slot: fall back to generic entity icon with the toolkit type
    return {
      ...(participant.entity_settings as Record<string, unknown>)?.icon_meta,
      entityType: isMCP ? 'mcp' : type,
    };
  }, [participant, resolveToolkitIcon, theme]);

  return entityIcon;
}
