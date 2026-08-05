// @ts-nocheck
/**
 * EditParticipantButton — edit gate button for a participant.
 *
 * Ported from `[fsd]/features/chat/participants/ui/ParticipantActions/EditParticipantButton.jsx`.
 *
 * Cross-cutting gap: the old app imported `usePublicProjectAccessCheck` from
 * `features/project/lib/hooks`. `features/project` does NOT exist in the new-app
 * (not owned by any Wave-2 unit). Conservative treatment: treat
 * `hasPublicProjectAccess` as always-false — public projects cannot be edited
 * by this component. This is a disclosed gap documented here and in the unit's
 * landing report for eventual resolution when a real permission source exists.
 *
 * FIXED regression: the real RBAC gate was previously hardcoded —
 * `const canEdit = (!isPublic && true) || ...` — so every participant was
 * editable by every user regardless of role, and `isPublic` was compared
 * against the string literal `'public'` instead of the real
 * `PUBLIC_PROJECT_ID` constant (making that branch dead in practice, since
 * real project ids are numeric/`'0'`). Both are restored below using
 * `ParticipantEditPermissionMap` (already ported to `../../model/
 * constants.ts`) and `PUBLIC_PROJECT_ID` (same file) — the permission check
 * itself (`useCheckPermission().checkPermission` in the old app) is
 * re-implemented as a small feature-local hook, following the same
 * "no-sideways-features" precedent `features/agents/lib/useHasPermission.ts`
 * and `features/chat-input/lib/hooks/useCheckPermission.hooks.ts` already
 * establish (each is its OWN feature-local copy — chat-participants may not
 * import either). Kept inline in this file rather than split into its own
 * `lib/hooks/useCheckPermission.ts` because this fix pass is scoped to this
 * cluster's 5 named files only; promote it to a shared feature-local hook
 * file the moment a second consumer in this feature needs it (same
 * "promote once a second consumer exists" convention those two precedents
 * document).
 */
import { memo, useCallback, useMemo } from 'react';

import { IconButton, Tooltip } from '@mui/material';

import EditIcon from '@mui/icons-material/Edit';

import { usePermissionList } from '@/shared/api/generated/auth/auth';
import type { Permission } from '@/shared/api/generated/model';
import { t } from '@/shared/i18n';

import { useSelectedProjectId } from '../../api/useSelectedProjectId';
import { PUBLIC_PROJECT_ID, ParticipantEditPermissionMap } from '../../model/constants';

// ---------------------------------------------------------------------------
// Local permission-check hook (see file header for why this is inline)
// ---------------------------------------------------------------------------

/**
 * Feature-local port of `apps/elitea-ui/src/hooks/useCheckPermission.js`,
 * scoped to this file's one consumer. Default-allow for a falsy/empty
 * permission argument mirrors the old app's own `checkPermission` (a
 * participant type with no entry in `ParticipantEditPermissionMap` — e.g.
 * users/MCP — is not permission-gated at all).
 */
function useCheckPermission(): (permission: string | undefined) => boolean {
  const projectId = useSelectedProjectId();
  const query = usePermissionList(projectId ?? '', { query: { enabled: projectId !== undefined } });

  const permissions = useMemo(() => {
    // `.data.data`'s declared type includes the error-envelope variant —
    // never actually reachable here, since `eliteaFetch` throws instead of
    // resolving with it (mutator.ts's §3.6 unwrap contract; same convention
    // `useHasPermission.ts`/`useCheckPermission.hooks.ts` already document).
    const list = query.data?.data as Permission[] | undefined;
    if (!list) return new Set<string>();
    return new Set(list.filter((entry) => entry.enabled).map((entry) => entry.name));
  }, [query.data]);

  return useCallback((permission: string | undefined) => (permission ? permissions.has(permission) : true), [permissions]);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EditParticipantButtonProps {
  participant: Record<string, unknown>;
  onEdit?: (participant: Record<string, unknown>) => void;
  disabled?: boolean;
  /** Type-specific tooltip override (e.g. "Edit pipeline") — see `ParticipantActions.tsx`. */
  tooltip?: string;
}

/**
 * EditParticipantButton component.
 *
 * Disclosed gap: `hasPublicProjectAccess` gate from old app is replaced with
 * `false` (public projects cannot be edited). See file header for details.
 */
const EditParticipantButton = memo((props: EditParticipantButtonProps): React.ReactElement | null => {
  const { participant, onEdit, disabled, tooltip } = props;
  const checkPermission = useCheckPermission();

  if (!onEdit) return null;

  const entityMeta = participant.entity_meta as Record<string, unknown> | undefined;
  const entityName = participant.entity_name as string | undefined;
  const isPublic = entityMeta?.project_id === PUBLIC_PROJECT_ID;
  // Disclosed gap — old app checked `hasPublicProjectAccess` from
  // `features/project/lib/hooks`. No equivalent exists in new-app. Treat
  // public project access as always-false.
  const hasPublicProjectAccess = false;

  const hasPermission = checkPermission(entityName ? ParticipantEditPermissionMap[entityName] : undefined);
  const canEdit = (!isPublic && hasPermission) || (isPublic && hasPublicProjectAccess);

  if (!canEdit || disabled) return null;

  const displayName = participant.entity_meta?.name || t('chat-participants.common.participant', 'Participant');
  const tooltipLabel = tooltip ?? t('chat-participants.tooltip.edit', 'Edit');

  return (
    <Tooltip title={`${tooltipLabel} ${displayName}`}>
      <IconButton
        size="small"
        aria-label={`${tooltipLabel} ${displayName}`}
        onClick={(e) => {
          e.stopPropagation();
          onEdit(participant);
        }}
        sx={{ color: 'text.secondary' }}
      >
        <EditIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
});

EditParticipantButton.displayName = 'EditParticipantButton';

export default EditParticipantButton;
