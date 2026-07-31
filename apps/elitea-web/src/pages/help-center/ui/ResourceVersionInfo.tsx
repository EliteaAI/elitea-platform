/**
 * ResourceVersionInfo — version info bar at the top of the Help Center.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/pages/resources/ui/ResourceVersionInfo.jsx`.
 *
 * In the full-featured version this queries system info and plugin versions
 * from the admin API. Per Key Decision #2 the admin endpoints lack OpenAPI
 * specs, so this renders a minimal static header with a copy-to-clipboard
 * button for the local version info (always empty in the prototype).
 *
 * TODO: wire into `useGetSystemInfoQuery` and `useGetResourcesConfigQuery`
 * once the Go endpoints are documented in the OpenAPI spec.
 */
import { memo, type ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import type { SystemStyleObject } from '@mui/system';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { CopyToClipboardButton } from '@/shared/ui/CopyToClipboardButton';
import { InfoIcon } from '@/shared/ui/icons/info-icon';

/** Props consumed by ResourceVersionInfo — currently empty (static render). */
export interface ResourceVersionInfoProps {
  /** Optional custom version label. Defaults to the empty string. */
  versionLabel?: string;
}

/** Theme-aware sx values for the version info header. */
const headerSx: SxProps<Theme> = (t: Theme): SystemStyleObject<Theme> => ({
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  px: t.spacing(3),
  height: '3.75rem',
  minHeight: '3.75rem',
  borderBottom: `0.0625rem solid ${t.palette.divider}`,
  backgroundColor: t.vars.palette.background?.tabPanel ?? t.palette.background.default,
});

const headerRightSx: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
};

const headerVersionInfoSx: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.375rem',
};

const infoIconSx: SxProps<Theme> = {
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  cursor: 'pointer',
  color: (t: Theme) => t.palette.text.primary,
};

const infoIconSvgSx: SxProps<Theme> = {
  width: '0.875rem',
  height: '0.875rem',
  display: 'block',
};

const tooltipContentSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  padding: '0.125rem',
};

/**
 * Header bar showing the "Help Center" title and optional version info.
 */
const ResourceVersionInfo = memo(({ versionLabel = '' }: ResourceVersionInfoProps): ReactNode => {
  const versionInfoText = versionLabel || '';
  const hasVersion = versionInfoText.length > 0;

  return (
    <Box sx={headerSx}>
      <Typography
        variant="headingMedium"
        color="text.secondary"
      >
        Help Center
      </Typography>
      <Box sx={headerRightSx}>
        {hasVersion && (
          <Box sx={headerVersionInfoSx}>
            <Typography
              variant="bodyMedium"
              color="text.secondary"
            >
              {versionInfoText}
            </Typography>
            <Tooltip
              placement="bottom-end"
              title={
                versionInfoText ? (
                  <Box sx={tooltipContentSx}>
                    <Typography variant="bodySmall">{versionInfoText}</Typography>
                  </Box>
                ) : null
              }
            >
              <Box sx={infoIconSx}>
                <Box
                  component={InfoIcon}
                  sx={infoIconSvgSx}
                />
              </Box>
            </Tooltip>
            <CopyToClipboardButton
              label=""
              value={versionInfoText}
              data-testid="copy-version-info"
            />
          </Box>
        )}
      </Box>
    </Box>
  );
});

ResourceVersionInfo.displayName = 'ResourceVersionInfo';

export default ResourceVersionInfo;
