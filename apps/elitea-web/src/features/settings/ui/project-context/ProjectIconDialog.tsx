/**
 * ProjectIconDialog — the project's icon picker.
 *
 * It is now a THIN WRAPPER over `shared/ui/IconPickerDialog`, which holds the
 * dialog itself. The body moved there unchanged when the skill icon picker
 * needed the same dialog: a feature cannot import another feature (R-L1), and
 * the old app's answer to this — a second, separately-drifting copy of the
 * dialog (`components/SelectIconDialog.jsx`) — is the outcome the move exists
 * to avoid. Everything specific to a PROJECT stays here: the three queries and
 * mutations, and the `onIconSelect` callback the parent persists through
 * `updateProjectInfo`.
 */
import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';

import { useDeleteProjectIconMutation, useProjectIconsQuery, useUploadProjectIconMutation } from '@/entities/project';
import { useGetApplicationDefaultIcons } from '@/shared/api/generated/applications/applications';
import type { DefaultIcon } from '@/shared/api/generated/model/defaultIcon.zod';
import { IconPickerDialog, type PickableIcon, type UploadDimensions } from '@/shared/ui/IconPickerDialog';

/** Both halves: the name alone stores a row the header cannot draw. */
export interface SelectedProjectIcon {
  name: string;
  url?: string | undefined;
}

export interface ProjectIconDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /**
   * Called when the user selects an icon, with BOTH halves (null to reset).
   *
   * Not the name alone. `ProjectParamsHeader` renders `icon_meta.url`, so a
   * name-only callback persists a row the header cannot draw — the write
   * succeeds and the icon never appears, which is the silent no-op this whole
   * path was fixed for. `SkillIconDialog` carries a meta object for the same
   * reason.
   */
  readonly onIconSelect?: ((icon: SelectedProjectIcon | null) => void) | undefined;
  readonly projectId: string;
  readonly selectedIcon?: PickableIcon | null | undefined;
  readonly projectName: string;
}

export function ProjectIconDialog({
  open,
  onClose,
  onIconSelect,
  projectId,
  selectedIcon,
  projectName,
}: ProjectIconDialogProps): ReactNode {
  const { data: defaultIconsResponse, isLoading: loadingDefault } = useGetApplicationDefaultIcons(projectId, {
    query: { enabled: open && !!projectId },
  });
  // Memoized because handleSelect depends on it: the `?? []` fallback is a new
  // array identity every render, which would rebuild the callback each time.
  const defaultIcons = useMemo(
    () => (defaultIconsResponse?.data ?? []) as DefaultIcon[],
    [defaultIconsResponse],
  );

  const { data: iconsResponse, isLoading: loadingIcons } = useProjectIconsQuery(projectId, {
    enabled: open && !!projectId,
  });
  const uploadedIcons = useMemo(() => iconsResponse?.rows ?? [], [iconsResponse]);

  const uploadMutation = useUploadProjectIconMutation(projectId);
  const deleteMutation = useDeleteProjectIconMutation(projectId);

  const handleUpload = useCallback(
    async (file: File, dimensions: UploadDimensions): Promise<void> => {
      await uploadMutation.mutateAsync({ file, ...dimensions });
      onClose();
    },
    [uploadMutation, onClose],
  );

  const handleDelete = useCallback(
    async (name: string): Promise<void> => {
      await deleteMutation.mutateAsync(name);
    },
    [deleteMutation],
  );

  // The shared picker reports the NAME it was given; the url lives on the icon
  // lists this wrapper already holds, so the lookup belongs here rather than in
  // shared/ui, which has no notion of a project icon's url shape.
  const handleSelect = useCallback(
    (name: string | null) => {
      if (name === null) {
        onIconSelect?.(null);
        return;
      }
      const match =
        uploadedIcons.find((icon) => icon.name === name) ??
        defaultIcons.find((icon) => icon.name === name);
      onIconSelect?.({ name, ...(match?.url === undefined ? {} : { url: match.url }) });
    },
    [onIconSelect, uploadedIcons, defaultIcons],
  );

  return (
    <IconPickerDialog
      open={open}
      onClose={onClose}
      selectedIcon={selectedIcon}
      placeholderName={projectName}
      defaultIcons={defaultIcons}
      loadingDefaultIcons={loadingDefault}
      uploadedIcons={uploadedIcons}
      loadingUploadedIcons={loadingIcons}
      onSelectIcon={handleSelect}
      onUpload={handleUpload}
      onDeleteIcon={handleDelete}
    />
  );
}
