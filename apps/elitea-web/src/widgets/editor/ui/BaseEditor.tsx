import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import { Alert, Box, SvgIcon } from '@mui/material';
import { useTheme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { BaseModal } from '@/shared/ui/BaseModal';
import { AttentionIcon } from '@/shared/ui/icons/attention-icon';

/**
 * Phase-3 Editor shell: BaseEditor
 * Stub — no external dependencies. Full implementation wired in Phase 5.
 */
export type BaseEditorProps = {
  isVisible: boolean;
  isDirty: boolean;
  setIsDirty?: (dirty: boolean) => void;
  onClose: () => void;
  title: string;
  subtitle?: string;
  onDiscard?: () => void;
  saveButton?: ReactNode;
  error?: unknown;
  onCloseError?: () => void;
  children: ReactNode;
};

/** Mirrors the baseline's `error?.data?.message || error?.message || 'Failed to load configuration'` fallback chain for an `unknown` API error shape. */
function resolveErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const withShape = error as { data?: { message?: unknown }; message?: unknown };
    if (typeof withShape.data?.message === 'string') return withShape.data.message;
    if (typeof withShape.message === 'string') return withShape.message;
  }
  return t('widgets.editor.baseEditor.loadError', 'Failed to load configuration');
}

const BaseEditor = ({
  isVisible,
  isDirty,
  onClose,
  title,
  subtitle,
  onDiscard,
  saveButton,
  error,
  onCloseError,
  children,
}: BaseEditorProps) => {
  const theme = useTheme();
  const [showWarning, setShowWarning] = useState(false);

  const handleCancel = useCallback(() => {
    if (isDirty) {
      setShowWarning(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  const handleDialogCancel = useCallback(() => {
    setShowWarning(false);
  }, []);

  const handleDialogConfirm = useCallback(() => {
    setShowWarning(false);
    onDiscard?.();
    onClose();
  }, [onClose, onDiscard]);

  return (
    <Box
      sx={{
        display: isVisible ? 'flex' : 'none',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        border: '1px solid',
        borderColor: 'border.lines',
        borderRadius: theme.vars.shape.radiusLg,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0.5rem 1rem',
          borderBottom: '1px solid',
          borderColor: 'border.lines',
          minHeight: '2.625rem',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.4 }}>
          <Box
            component="span"
            sx={{ fontSize: theme.typography.headingMedium.fontSize, cursor: 'pointer' }}
            onClick={handleCancel}
          >
            {t('widgets.editor.baseEditor.close', '✕')}
          </Box>
          <Box>
            <Box sx={{ fontWeight: 600, fontSize: theme.typography.headingSmall.fontSize, lineHeight: '1.5rem' }}>
              {title}
            </Box>
            {subtitle && (
              <Box sx={{ fontSize: theme.typography.bodySmall.fontSize, lineHeight: '1rem' }}>{subtitle}</Box>
            )}
          </Box>
        </Box>
        {saveButton && <Box sx={{ display: 'flex', alignItems: 'center' }}>{saveButton}</Box>}
      </Box>
      <Box sx={{ flexGrow: 1, overflow: 'auto', padding: theme.spacing(2) }}>
        {Boolean(error) && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            onClose={onCloseError}
          >
            {resolveErrorMessage(error)}
          </Alert>
        )}
        {children}
      </Box>

      <BaseModal
        variant="simple"
        open={showWarning}
        onClose={handleDialogCancel}
        onConfirm={handleDialogConfirm}
        title={t('widgets.editor.baseEditor.warningTitle', 'Warning')}
        content={t(
          'widgets.editor.baseEditor.warningContent',
          'You are editing now. Do you want to discard current changes and continue?',
        )}
        header={{
          icon: (
            <SvgIcon
              component={AttentionIcon}
              inheritViewBox
              sx={{ width: '1.5rem', height: '1.5rem' }}
            />
          ),
        }}
        actions={{
          confirmText: t('widgets.editor.baseEditor.confirm', 'Confirm'),
          alarm: true,
        }}
      />
    </Box>
  );
};

BaseEditor.displayName = 'BaseEditor';

export default BaseEditor;
