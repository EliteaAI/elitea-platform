/**
 * IDE settings preview panel — shows generated VSCode / JetBrains config for
 * a given personal token.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/personal-tokes/
 * SettingsPreview.jsx`.
 *
 * Deviations:
 *  - No CodeMirror (not ported to new-app) — renders raw `<pre>` content
 *  - Uses `@/shared/ui/lib/t` for i18n
 *  - Simpler copy/download UX — direct clipboard/file ops (no toast in shared/ui)
 *  - Uses `openEyeIcon` and `RemoveIcon` (existing in shared/ui/icons)
 *  - Close button uses "✕" text (close-icon doesn't exist)
 */
import { memo, useCallback, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import SvgIcon from '@mui/material/SvgIcon';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

import { RemoveIcon } from '@/shared/ui/icons/remove-icon';
import { OpenEyeIcon } from '@/shared/ui/icons/open-eye-icon';
import { t } from '@/shared/ui/lib/t';
import { SETTINGS_PREVIEW_LABELS, SETTINGS_PREVIEW_TYPES } from '@/entities/token/model/constants';

export interface SettingsPreviewProps {
  /** The raw token string. */
  token: string;
  /** Display name of the token. */
  tokenName: string;
  /** Selected IDE type — 'vscode' or 'jetbrains'. */
  selectedIDE: 'vscode' | 'jetbrains';
  /** Callback when user changes the selected IDE. */
  onIdeChange: (ide: 'vscode' | 'jetbrains') => void;
  /** Callback when the user closes the panel. */
  onClose: () => void;
}

/** Generate VSCode settings JSON for the given values. */
function generateVSCodeSettings(token: string): string {
  return JSON.stringify(
    {
      'eliteacode.providerServerURL': '',
      'eliteacode.LLMServerUrl': '',
      'eliteacode.modelName': '',
      'eliteacode.LLMModelName': '',
      'eliteacode.authToken': token || 'Your_Personal_Token',
      'eliteacode.LLMAuthToken': token || 'Your_Personal_Token',
      'eliteacode.projectId': '',
      'eliteacode.integrationUid': '',
      'eliteacode.defaultViewMode': 'split',
      'eliteacode.verifySsl': false,
      'eliteacode.displayType': 'split',
      'eliteacode.debug': false,
    },
    null,
    2,
  );
}

/** Generate JetBrains .idea settings XML for the given values. */
function generateJetBrainsSettings(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="EliteASettings">
    <option name="displayType" value="SPLIT" />
    <option name="integrationName" value="" />
    <option name="integrationUid" value="" />
    <option name="llmCustomModelEnabled" value="true" />
    <option name="llmCustomModelName" value="" />
    <option name="llmServerUrl" value="" />
    <option name="projectId" value="" />
    <option name="provider" value="ELITEA_EYE" />
  </component>
</project>`;
}

export const SettingsPreview = memo(function SettingsPreview({
  token,
  tokenName,
  selectedIDE,
  onIdeChange,
  onClose,
}: SettingsPreviewProps) {
  const theme = useTheme();
  const styles = getStyles();

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const ideOptions = useMemo(
    () =>
      Object.values(SETTINGS_PREVIEW_TYPES).map((type) => ({
        label: SETTINGS_PREVIEW_LABELS[type],
        value: type,
      })),
    [],
  );

  const settingsContent = useMemo(() => {
    if (selectedIDE === 'vscode') {
      return generateVSCodeSettings(token);
    }
    return generateJetBrainsSettings();
  }, [selectedIDE, token]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(settingsContent);
    } catch {
      // clipboard write failed — no toast in shared/ui
    }
  }, [settingsContent]);

  const handleDownload = useCallback(() => {
    const ext = selectedIDE === 'vscode' ? 'json' : 'xml';
    const mimeType = selectedIDE === 'vscode' ? 'application/json' : 'application/xml';
    const element = document.createElement('a');
    const file = new Blob([settingsContent], { type: mimeType });
    element.href = URL.createObjectURL(file);
    element.download = `settings.${ext}`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    URL.revokeObjectURL(element.href);
  }, [settingsContent, selectedIDE]);

  const ideLabel = SETTINGS_PREVIEW_LABELS[selectedIDE] || selectedIDE;
  const canvasTitle = tokenName
    ? `${tokenName} • ${t('entities.token.preview.ideSettings', 'IDE Settings')}`
    : ideLabel;

  return (
    <Box sx={styles.root}>
      <Box sx={styles.header}>
        <Box sx={styles.headerLeft}>
          <IconButton
            size="small"
            onClick={onClose}
            aria-label={t('entities.token.preview.close', 'Close preview')}
          >
            <span style={{ fontSize: '0.875rem' }}>✕</span>
          </IconButton>
          <Typography
            variant="headingSmall"
            color="text.secondary"
            sx={styles.title}
          >
            {canvasTitle}
          </Typography>
        </Box>
        <Box sx={styles.headerRight}>
          {/* IDE selector */}
          <Tooltip title={t('entities.token.preview.selectIde', 'Select IDE')}>
            <IconButton
              size="small"
              onClick={(e) => setAnchorEl(e.currentTarget)}
            >
              <Typography variant="bodySmall">{ideLabel}</Typography>
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={() => setAnchorEl(null)}
          >
            {ideOptions.map((opt) => (
              <MenuItem
                key={opt.value}
                selected={opt.value === selectedIDE}
                onClick={() => {
                  onIdeChange(opt.value as 'vscode' | 'jetbrains');
                  setAnchorEl(null);
                }}
              >
                {opt.label}
              </MenuItem>
            ))}
          </Menu>

          <Tooltip title={t('entities.token.preview.copy', 'Copy settings')}>
            <IconButton
              size="small"
              onClick={handleCopy}
            >
              <SvgIcon
                component={OpenEyeIcon}
                inheritViewBox
                sx={{ width: '0.875rem', height: '0.875rem' }}
              />
            </IconButton>
          </Tooltip>

          <Tooltip title={t('entities.token.preview.download', 'Download settings')}>
            <IconButton
              size="small"
              onClick={handleDownload}
            >
              <SvgIcon
                component={RemoveIcon}
                inheritViewBox
                sx={{ width: '0.875rem', height: '0.875rem' }}
              />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
      <Box sx={styles.content}>
        <pre
          style={{
            margin: 0,
            padding: '1rem',
            fontSize: '0.8125rem',
            fontFamily: 'monospace',
            overflow: 'auto',
            height: '100%',
            background: theme.palette.background.paper,
            color: theme.palette.text.primary,
          }}
        >
          {settingsContent}
        </pre>
      </Box>
    </Box>
  );
});

const getStyles = (): {
  root: SxProps<Theme>;
  header: SxProps<Theme>;
  headerLeft: SxProps<Theme>;
  headerRight: SxProps<Theme>;
  title: SxProps<Theme>;
  content: SxProps<Theme>;
} => ({
  root: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    borderRadius: '0.5rem',
    overflow: 'hidden',
    minHeight: 0,
    minWidth: '18.75rem',
  },
  header: ({ palette }) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    padding: '0.5rem 0.75rem',
    backgroundColor: palette.background.tabPanel,
    borderBottom: `0.0625rem solid ${palette.border.lines}`,
    minHeight: '3.75rem',
    flexShrink: 0,
  }),
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flex: 1,
    minWidth: 0,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  title: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  content: ({ palette }) => ({
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: palette.background.paper,
    minHeight: 0,
  }),
});
