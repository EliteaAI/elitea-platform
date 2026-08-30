// @ts-nocheck
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
import { useTheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';

import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';

import type { DefaultIcon } from '@/shared/api/generated/model/defaultIcon.zod';
import { useDeleteProjectIconMutation, useProjectIconsQuery, useUploadProjectIconMutation } from '@/entities/project';
import { useGetApplicationDefaultIcons } from '@/shared/api/generated/applications/applications';

import { BaseModal } from '@/shared/ui/BaseModal';
import { ProjectIconItem } from './ProjectIconItem';
import { UserIconItem } from './UserIconItem';
import { t } from '@/shared/i18n';

/** Both halves: the name alone stores a row the header cannot draw (it renders `icon_meta.url`). */
export interface SelectedProjectIcon { name: string; url?: string }
export interface ProjectIconDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called when the user selects an icon — null resets to the letter avatar. */
  onIconSelect?: (icon: SelectedProjectIcon | null) => void;
  projectId: string;
  selectedIcon?: { name?: string; url?: string } | null;
  projectName: string;
}

// ---------------------------------------------------------------------------
// Helper: upload a single file (complexity ≤ 4)
// ---------------------------------------------------------------------------

interface UploadFileParams {
  file: File;
  uploadMutation: { mutateAsync: (args: { file: File; width: number; height: number }) => Promise<void> };
  onClose: () => void;
}

/**
 * Decodes `file` through `Image()` to get its real (capped-at-64) pixel
 * dimensions. Never called for TIFF — see `uploadFile`'s own comment:
 * browsers cannot decode TIFF via `Image()`, so `image.onload` would never
 * fire for it.
 */
function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const image = new Image();
      image.onload = () => {
        resolve({
          width: image.width > 64 ? 64 : image.width,
          height: image.height > 64 ? 64 : image.height,
        });
      };
      image.onerror = () => {
        reject(new Error(`uploadFile: failed to decode image "${file.name}"`));
      };
      image.src = (e.target?.result as string) ?? '';
    };
    reader.onerror = () => {
      reject(new Error(`uploadFile: failed to read file "${file.name}"`));
    };
    reader.readAsDataURL(file);
  });
}

async function uploadFile({ file, uploadMutation, onClose }: UploadFileParams): Promise<void> {
  // TIFF cannot be decoded via `Image()` in browsers — `image.onload` never
  // fires for it, so skip dimension detection and use fixed 64x64 dims
  // (old-app parity: SelectProjectIconDialog.jsx's `file.type === 'image/tiff'` branch).
  const { width, height } =
    file.type === 'image/tiff' ? { width: 64, height: 64 } : await readImageDimensions(file);
  await uploadMutation.mutateAsync({ file, width, height });
  onClose();
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
  const uploadedIcons = iconsResponse?.rows ?? [];

  const uploadMutation = useUploadProjectIconMutation(projectId);
  const deleteMutation = useDeleteProjectIconMutation(projectId);

  /* ── icon selection handler ───────────────────────────────────────── */
  const handleSelectIcon = useCallback(
    (icon: SelectedProjectIcon | null) => {
      onIconSelect?.(icon);
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
      void uploadFile({
        file,
        uploadMutation,
        onClose,
      }).finally(() => {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      });
    },
    [uploadMutation, onClose, fileInputRef],
  );

  const handleDeleteIcon = useCallback(
    async (name: string) => {
      try {
        await deleteMutation.mutateAsync(name);
        // Only reset the selection (to null, never the just-deleted name)
        // when the deleted icon was the currently-selected one — and leave
        // the dialog open either way (old-app parity: SelectProjectIconDialog.jsx:75-88
        // never calls onClose() from onDeleteIcon).
        if (selectedIcon?.name === name) {
          onIconSelect?.(null);
        }
      } catch {
        // Error toast handled by mutation.
      }
    },
    [deleteMutation, onIconSelect, selectedIcon],
  );

  /* ── render ────────────────────────────────────────────────────────── */

  return (
    <BaseModal
      open={open}
      onClose={onClose}
      title={t('entities.projectContext.projectIconDialog.title', 'Choose an icon')}
      content={
        <>
          <DefaultIconsSection
            projectName={projectName}
            selectedIcon={selectedIcon}
            defaultIcons={defaultIcons}
            loadingDefault={loadingDefault}
            onSelectIcon={handleSelectIcon}
          />
          <UploadedIconsSection
            uploadedIcons={uploadedIcons}
            loadingIcons={loadingIcons}
            selectedIcon={selectedIcon}
            onSelectIcon={handleSelectIcon}
            onDeleteIcon={handleDeleteIcon}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.tiff,.webp,.gif,.bmp,.ico"
            style={{ display: 'none' }}
            onChange={(e) => { handleFileSelect(e); }}
          />
        </>
      }
      actions={{
        node: (
          <UploadIconButton
            fileInputRef={fileInputRef}
            isUploading={isUploading}
          />
        ),
      }}
    />
  );
}

/* ── sub-components ────────────────────────────────────────────────────── */

function DefaultIconsSection({
  projectName,
  selectedIcon,
  defaultIcons,
  loadingDefault,
  onSelectIcon,
}: {
  projectName: string;
  selectedIcon?: { name?: string; url?: string } | null;
  defaultIcons: DefaultIcon[];
  loadingDefault: boolean;
  onSelectIcon: (icon: SelectedProjectIcon | null) => void;
}) {
  return (
    <Box>
      <Typography variant="labelSmall" color="text.tertiary" sx={cx.sectionLabel}>
        {t('entities.projectContext.projectIconDialog.defaultSection', 'Default')}
      </Typography>
      <Box sx={cx.iconGrid}>
        {!selectedIcon?.url && !selectedIcon?.name ? (
          <ProjectIconItem isSelected onClick={() => onSelectIcon(null)}>
          <IconPlaceholder name={projectName} />
          </ProjectIconItem>
        ) : null}
        {!loadingDefault &&
          defaultIcons.map((icon) => (
            <ProjectIconItem
              key={icon.name}
              isSelected={selectedIcon?.name === icon.name}
              onClick={() => onSelectIcon({ name: icon.name, url: icon.url })}
            >
              <IconPlaceholder name={icon.name} url={icon.url} />
            </ProjectIconItem>
          ))}
      </Box>
    </Box>
  );
}

function UploadedIconsSection({
  uploadedIcons,
  loadingIcons,
  selectedIcon,
  onSelectIcon,
  onDeleteIcon,
}: {
  uploadedIcons: Array<{ name: string; url?: string }>;
  loadingIcons: boolean;
  selectedIcon?: { name?: string; url?: string } | null;
  onSelectIcon: (icon: SelectedProjectIcon | null) => void;
  onDeleteIcon: (name: string) => Promise<void>;
}) {
  return (
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
            onClick={() => onSelectIcon({ name: icon.name, url: icon.url })}
            onDelete={() => { void onDeleteIcon(icon.name); }}
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
  );
}

function UploadIconButton({
  fileInputRef,
  isUploading,
}: {
  fileInputRef: React.RefObject<HTMLInputElement>;
  isUploading: boolean;
}) {
  return (
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
  );
}

/**
 * IconPlaceholder shows the icon image, or the first letter of its name.
 *
 * DEFECT: the url branch had no error handler. A url that answers 404
 * therefore left a broken-image box on the screen. The letter fallback below
 * never ran. The
 * default-icon catalogue served five such urls, and an uploaded icon that is
 * deleted or expired produces the same result. `failedUrl` records the url that
 * failed and falls through to the letter. It keys on the url, so a later change
 * to a good url shows the image again.
 */
function IconPlaceholder({ name, url }: { name: string; url?: string }) {
  // The glyph size comes from the theme HERE, not from a prop.
  //
  // DEFECT: the three call sites read a `_theme` constant that lives in
  // ProjectIconDialog, but they sat in separate function components. The
  // identifier therefore resolved to nothing at run time. The file carries
  // `@ts-nocheck`,
  // so the compiler never reported it. The dialog threw
  // "ReferenceError: _theme is not defined" and unmounted the whole page as
  // soon as it had one icon to draw.
  const theme = useTheme() as Theme;
  const fontSize = theme.typography.headingSmall.fontSize;
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined);
  const onError = useCallback(() => { setFailedUrl(url); }, [url]);

  if (url && failedUrl !== url) {
    return (
      <Box
        component="img"
        src={url}
        alt={name}
        onError={onError}
        sx={{ ...cx.iconImage }}
      />
    );
  }
  const initial = name ? name.charAt(0).toUpperCase() : '?';
  return (
    <Box sx={{ ...cx.fallbackIcon, fontSize }}>
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
    borderRadius: 'var(--el-shape-radiusPill, 9999px)',
    objectFit: 'cover',
  } as React.CSSProperties,
  fallbackIcon: {
    width: '2.25rem',
    height: '2.25rem',
    borderRadius: 'var(--el-shape-radiusPill, 9999px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 'var(--el-font-h3, 1rem)',
    fontWeight: 600,
    color: 'text.primary',
  } as React.CSSProperties,
};
