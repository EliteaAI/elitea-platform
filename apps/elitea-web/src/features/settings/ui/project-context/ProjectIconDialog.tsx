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
import { useCallback } from 'react';

import { useDeleteProjectIconMutation, useProjectIconsQuery, useUploadProjectIconMutation } from '@/entities/project';
import { useGetApplicationDefaultIcons } from '@/shared/api/generated/applications/applications';
import type { DefaultIcon } from '@/shared/api/generated/model/defaultIcon.zod';
import { IconPickerDialog, type PickableIcon, type UploadDimensions } from '@/shared/ui/IconPickerDialog';

export interface ProjectIconDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Called when the user selects an icon — passes the icon name (null to reset). */
  readonly onIconSelect?: ((iconName: string | null) => void) | undefined;
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
  const defaultIcons = (defaultIconsResponse?.data ?? []) as DefaultIcon[];

  const { data: iconsResponse, isLoading: loadingIcons } = useProjectIconsQuery(projectId, {
    enabled: open && !!projectId,
  });
  const uploadedIcons = iconsResponse?.rows ?? [];

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

  const handleSelect = useCallback(
    (name: string | null) => {
      onIconSelect?.(name);
    },
    [onIconSelect],
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
