/**
 * ProjectIconDialog — dialog for selecting or uploading a project icon.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/project-context/SelectProjectIconDialog.jsx`.
 *
 * Uses generated `useGetApplicationDefaultIcons` for default icons and handwritten
 * hooks for uploaded icons, upload, and delete.
 *
 * Deviations from the baseline:
 *  - Adds `onIconSelect` callback so the parent can persist the icon selection
 *    via `updateProjectInfo` mutation (Task 3 fix)
 */
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { useCallback, useRef, useState } from 'react';

import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';

import type { DefaultIcon } from '@/shared/api/generated/model/defaultIcon.zod';
import type { UploadedIcon } from '@/entities/project/model/projectContextTypes';
import { useDeleteProjectIconMutation, useProjectIconsQuery, useUploadProjectIconMutation } from '@/entities/project/api/projectContextApi';
import { useGetApplicationDefaultIcons } from '@/shared/api/generated/applications/applications';

import { BaseModal } from '@/shared/ui/BaseModal';
import { ProjectIconItem } from './ProjectIconItem';
import { UserIconItem } from './UserIconItem';
import { t } from '@/shared/i18n';

export interface ProjectIconDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called when the user selects an icon — passes the icon name (null to reset). */
  onIconSelect?: (iconName: string | null) => void;
  projectId: string;
  selectedIcon?: { name?: string; url?: string } | null;
  projectName: string;
}

export function ProjectIconDialog({
  open,
  onClose,
  onIconSelect,
  projectId,
  selectedIcon,
  projectName,
}: ProjectIconDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const { data: defaultIconsResponse, isLoading: loadingDefault } =
    useGetApplicationDefaultIcons(projectId, {
      query: { enabled: open && !!projectId },
    });
  const defaultIcons = (defaultIconsResponse?.data ?? []) as DefaultIcon[];

  const { data: iconsResponse, isLoading: loadingIcons } =
    useProjectIconsQuery(projectId, {
      enabled: open && !!projectId,
    });
  const uploadedIcons = (iconsResponse?.rows as UploadedIcon[] | undefined) ?? [];

  const uploadMutation = useUploadProjectIconMutation(projectId);
  const deleteMutation = useDeleteProjectIconMutation(projectId);

  /* ── icon selection handler ───────────────────────────────────────── */
  const handleSelectIcon = useCallback(
    (iconName: string | null) => {
      onIconSelect?.(iconName);
      onClose();
    },
    [onIconSelect, onClose],
  );

  /* ── handlers ──────────────────────────────────────────────────────── */

  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setIsUploading(true);
      try {
        const reader = new FileReader();
        reader.onload = (e) => {
          const image = new Image();
          image.onload = async () => {
            const w = image.width > 64 ? 64 : image.width;
            const h = image.height > 64 ? 64 : image.height;
            await uploadMutation.mutateAsync({ file, width: w, height: h });
            onClose();
          };
          image.src = (e.target?.result as string) ?? '';
        };
        reader.readAsDataURL(file);
      } catch {
        // Error toast handled by mutation.
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [uploadMutation, onClose],
  );

  const handleDeleteIcon = useCallback(
    async (name: string) => {
      try {
        await deleteMutation.mutateAsync(name);
        onIconSelect?.(selectedIcon?.name ?? null);
        onClose();
      } catch {
        // Error toast handled by mutation.
      }
    },
    [deleteMutation, onIconSelect, onClose, selectedIcon],
  );

  /* ── render ────────────────────────────────────────────────────────── */

  return (
    <BaseModal
      open={open}
      onClose={onClose}
      title={t('entities.projectContext.projectIconDialog.title', 'Choose an icon')}
      content={
        <Box sx={cx.content}>
          {/* Default icons */}
          <Box>
            <Typography variant="labelSmall" color="text.tertiary" sx={cx.sectionLabel}>
              {t('entities.projectContext.projectIconDialog.defaultSection', 'Default')}
            </Typography>
            <Box sx={cx.iconGrid}>
              {!selectedIcon?.url && !selectedIcon?.name ? (
                <ProjectIconItem isSelected onClick={() => void handleSelectIcon(null)}>
                  <IconPlaceholder name={projectName} />
                </ProjectIconItem>
              ) : null}
              {!loadingDefault &&
                defaultIcons.map((icon) => (
                  <ProjectIconItem
                    key={icon.name}
                    isSelected={selectedIcon?.name === icon.name}
                    onClick={() => void handleSelectIcon(icon.name)}
                  >
                    <IconPlaceholder name={icon.name} url={icon.url} />
                  </ProjectIconItem>
                ))}
            </Box>
          </Box>

          {/* Uploaded icons */}
          <Box>
            <Typography variant="labelSmall" color="text.tertiary" sx={cx.sectionLabel}>
              {t('entities.projectContext.projectIconDialog.uploadedSection', 'Uploaded')}
            </Typography>
            <Box sx={cx.iconGrid}>
              {loadingIcons && (
                <Box sx={cx.loader}>
                  <CircularProgress size={24} />
                </Box>
              )}
              {uploadedIcons.map((icon) => (
                <UserIconItem
                  key={icon.name}
                  isSelected={selectedIcon?.name === icon.name}
                  onClick={() => void handleSelectIcon(icon.name)}
                  onDelete={() => { handleDeleteIcon(icon.name).catch(() => {}); }}
                >
                  <IconPlaceholder name={icon.name} url={icon.url} />
                </UserIconItem>
              ))}
              {!loadingIcons && uploadedIcons.length === 0 && (
                <Typography variant="bodySmall" color="text.tertiary">
                  {t('entities.projectContext.projectIconDialog.noUploaded', 'No uploaded icons yet')}
                </Typography>
              )}
            </Box>
          </Box>

          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.tiff,.webp,.gif,.bmp,.ico"
            style={{ display: 'none' }}
            onChange={(e) => { void handleFileSelect(e); }}
          />
        </Box>
      }
      actions={{
        node: (
          <Box>
            <IconButton
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              size="small"
            >
              {isUploading ? (
                <CircularProgress size={16} />
              ) : (
                <ArrowUpwardIcon />
              )}
            </IconButton>
          </Box>
        ),
      }}
    />
  );
}

function IconPlaceholder({ name, url }: { name: string; url?: string }) {
  if (url) {
    return (
      <Box
        component="img"
        src={url}
        alt={name}
        sx={cx.iconImage}
      />
    );
  }
  const initial = name ? name.charAt(0).toUpperCase() : '?';
  return (
    <Box sx={cx.fallbackIcon}>
      {initial}
    </Box>
  );
}

const cx = {
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  } as React.CSSProperties,
  sectionLabel: { marginBottom: '0.5rem' } as React.CSSProperties,
  iconGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem',
  } as React.CSSProperties,
  loader: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    padding: '1rem 0',
  } as React.CSSProperties,
  iconImage: {
    width: '2.25rem',
    height: '2.25rem',
    borderRadius: '50%',
    objectFit: 'cover',
  } as React.CSSProperties,
  fallbackIcon: {
    width: '2.25rem',
    height: '2.25rem',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1rem',
    fontWeight: 600,
    color: 'text.primary',
  } as React.CSSProperties,
};
