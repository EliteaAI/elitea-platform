import type { MouseEvent, ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import CheckIcon from '@mui/icons-material/Check';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import type { SxProps, Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { combineSx } from '@/shared/ui/lib/combineSx';
import { RefreshIcon } from '@/shared/ui/icons/refresh-icon';

import type { AgentPipelineVersionOption } from '../lib/types';

const LATEST_VERSION_NAME = 'base';

/**
 * Ported from `apps/elitea-ui/src/pages/Applications/Components/Tools/AgentPipelineVersionSelector.jsx`.
 *
 * `LATEST_VERSION_NAME` ('base') is duplicated here rather than imported
 * from `entities/version` — same reason `entities/application-form/model/
 * initialValues.ts` already documents for its own copy: `no-sideways-*`
 * boundaries make a fresh small-constant duplication cheaper than a new
 * import edge for one string.
 *
 * MAJOR DISCLOSED REDESIGN — the version-SWITCH mutation is entirely
 * caller-owned. The baseline hook-mixes-with-component version of this file
 * calls, inline: `useApplicationDetailsQuery`/`useLazyGetApplicationVersionDetailQuery`/
 * `useUpdateApplicationRelationMutation` (old-app `@/api/applications`,
 * RTK-Query), `useSetRefetchDetails` (`features/agent/lib/hooks`, a
 * DIFFERENT A1 sub-unit's ownership, same slice but not this one's owned
 * file), `useSelectedProjectId`/`useToast` (generic infra with no
 * `features/`-importable equivalent yet — see `src/app/router-context.ts`'s
 * own doc comment: "this almost certainly blocks every OTHER Wave-2 A* unit
 * the same way"), and `useFormikContext` for `setFieldValue`/`dirty`/
 * `resetForm` (this app has no ambient form context at all in this
 * cluster — see `ToolCard.tsx`'s header for why props, not
 * `useFormContext()`, is this cluster's consistent choice). None of that
 * is "version selector" domain logic — it is application-form mutation
 * orchestration that belongs to whichever sub-unit owns the top-level
 * create/edit form (`AgentEditor.jsx`, per this batch's cross-domain
 * export requirement).
 *
 * What stays here, faithfully: the dropdown's pure presentation
 * (`formatVersionDisplayText`/`displayText`/`isInvalidVersionReference`/
 * `selectedVersion` — all pure functions of `versions` + the tool's own
 * `settings.application_version_id`) and the menu interaction. The caller
 * supplies the resolved `versions` list, the refresh trigger, and a single
 * `onSelectVersion` callback that performs the whole switch (mutation +
 * form sync + toast) — same "imperative trigger, no Formik/Redux/router
 * coupling" shape `entities/application-form/model/mutations.ts` already
 * established for the sibling create/save mutations.
 *
 * `renderTrigger`/`renderMenu` below are plain (lowercase, non-component)
 * render functions, not `<Trigger/>`/`<Menu/>` sub-components — each is its
 * own function scope for the `oxlint` `complexity` budget (≤12; this
 * component measured 17 with everything inline), without also creating a
 * NEW component the §3.5 12-props budget would apply to (its checker keys
 * on a capitalised function name).
 */
export interface AgentPipelineVersionSelectorProps {
  readonly applicationVersionId: number | string | undefined;
  readonly disabled?: boolean | undefined;
  readonly versions: readonly AgentPipelineVersionOption[];
  readonly isRefreshingVersions?: boolean | undefined;
  readonly onRefreshVersions?: (() => void) | undefined;
  readonly isSwitchingVersion?: boolean | undefined;
  readonly onSelectVersion: (version: AgentPipelineVersionOption) => void;
}

interface DisplayVersion extends AgentPipelineVersionOption {
  readonly isLatest: boolean;
}

function toDisplayVersions(versions: readonly AgentPipelineVersionOption[]): readonly DisplayVersion[] {
  return [...versions]
    .map((version): DisplayVersion => ({ ...version, isLatest: version.name === LATEST_VERSION_NAME }))
    .sort((a, b) => {
      if (a.isLatest && !b.isLatest) return -1;
      if (!a.isLatest && b.isLatest) return 1;
      const dateA = new Date(a.created_at ?? 0).getTime();
      const dateB = new Date(b.created_at ?? 0).getTime();
      return dateB - dateA;
    });
}

function formatVersionDisplayText(version: DisplayVersion): string {
  if (version.isLatest) return LATEST_VERSION_NAME;
  const versionName = version.name || 'Unnamed version';
  if (!version.created_at) return versionName;
  const date = new Date(version.created_at);
  if (Number.isNaN(date.getTime())) return versionName;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${versionName} – ${day}.${month}.${year}`;
}

function renderTrigger(params: { displayText: string; isInvalid: boolean; isSwitching: boolean; disabled: boolean | undefined; isOpen: boolean; onClick: (event: MouseEvent<HTMLElement>) => void }): ReactNode {
  const { displayText, isInvalid, isSwitching, disabled, isOpen, onClick } = params;
  return (
    <Box
      data-testid="version-selector-trigger"
      sx={combineSx(selectorSx, disabled ? { cursor: 'default' } : {})}
      onClick={isSwitching || disabled ? undefined : onClick}
    >
      {isInvalid && <WarningAmberIcon sx={warningIconSx} />}
      <Typography
        variant="bodySmall"
        className="agents-version-text"
        sx={isInvalid ? versionTextInvalidSx : versionTextSx}
      >
        {displayText}
      </Typography>
      {isSwitching && (
        <CircularProgress
          size={16}
          data-testid="version-selector-switching"
        />
      )}
      {!disabled && (
        <KeyboardArrowDownIcon
          className="agents-dropdown-icon"
          sx={combineSx(isInvalid ? dropdownIconInvalidSx : dropdownIconSx, { transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' })}
        />
      )}
    </Box>
  );
}

function renderMenu(params: {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  isRefreshingVersions: boolean;
  onRefresh: (event: MouseEvent) => void;
  displayVersions: readonly DisplayVersion[];
  selectedVersionId: number | undefined;
  onVersionClick: (version: DisplayVersion) => () => void;
}): ReactNode {
  const { anchorEl, onClose, isRefreshingVersions, onRefresh, displayVersions, selectedVersionId, onVersionClick } = params;
  return (
    <Menu
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={onClose}
      transformOrigin={{ horizontal: 'left', vertical: 'top' }}
      anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
      slotProps={{ paper: { sx: menuPaperSx }, list: { sx: menuListSx } }}
    >
      <Box sx={versionHeaderSx}>
        <Typography
          variant="labelSmall"
          sx={versionHeaderTitleSx}
        >
          {t('agents.versionSelector.versionsHeading', 'Versions')}
        </Typography>
        <Tooltip
          title={t('agents.versionSelector.refreshTooltip', 'Refresh versions')}
          placement="top"
        >
          <IconButton
            color="tertiary"
            size="small"
            onClick={onRefresh}
            disabled={isRefreshingVersions}
          >
            {isRefreshingVersions ? <CircularProgress size={12} /> : <RefreshIcon style={refreshIconStyle} />}
          </IconButton>
        </Tooltip>
      </Box>

      {displayVersions.length === 0 && <MenuItem disabled>{t('agents.versionSelector.noVersions', 'No versions available')}</MenuItem>}

      {displayVersions.map((version) => {
        const isSelected = selectedVersionId === version.id;
        return (
          <MenuItem
            key={version.id}
            onClick={onVersionClick(version)}
            sx={isSelected ? selectedMenuItemSx : menuItemSx}
          >
            <Typography variant="bodyMedium">{formatVersionDisplayText(version)}</Typography>
            {isSelected && <CheckIcon sx={selectedCheckIconSx} />}
          </MenuItem>
        );
      })}
    </Menu>
  );
}

export function AgentPipelineVersionSelector({
  applicationVersionId,
  disabled,
  versions,
  isRefreshingVersions = false,
  onRefreshVersions,
  isSwitchingVersion = false,
  onSelectVersion,
}: AgentPipelineVersionSelectorProps): ReactNode {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const displayVersions = useMemo(() => toDisplayVersions(versions), [versions]);

  const isInvalidVersionReference = useMemo(
    () => !!applicationVersionId && displayVersions.length > 0 && !displayVersions.some((v) => v.id === applicationVersionId),
    [applicationVersionId, displayVersions],
  );

  const selectedVersion = useMemo(() => displayVersions.find((v) => v.id === applicationVersionId) ?? displayVersions[0], [applicationVersionId, displayVersions]);

  const displayText = useMemo(() => {
    if (isInvalidVersionReference) return t('agents.versionSelector.invalidVersion', 'Invalid version');
    return selectedVersion ? formatVersionDisplayText(selectedVersion) : LATEST_VERSION_NAME;
  }, [isInvalidVersionReference, selectedVersion]);

  const handleClick = useCallback((event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget), []);
  const handleClose = useCallback(() => setAnchorEl(null), []);

  const handleRefresh = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      onRefreshVersions?.();
    },
    [onRefreshVersions],
  );

  const handleVersionClick = useCallback(
    (version: DisplayVersion) => () => {
      setAnchorEl(null);
      onSelectVersion(version);
    },
    [onSelectVersion],
  );

  const content = (
    <Box sx={contentWrapperSx}>
      {renderTrigger({ displayText, isInvalid: isInvalidVersionReference, isSwitching: isSwitchingVersion, disabled, isOpen: !!anchorEl, onClick: handleClick })}
      {renderMenu({ anchorEl, onClose: handleClose, isRefreshingVersions, onRefresh: handleRefresh, displayVersions, selectedVersionId: selectedVersion?.id, onVersionClick: handleVersionClick })}
    </Box>
  );

  if (!isInvalidVersionReference) return content;

  return (
    <Tooltip
      title={t('agents.versionSelector.invalidVersionTooltip', "The selected version no longer exists. Please select a valid version or remove this agent/pipeline.")}
      placement="top"
      arrow
    >
      {content}
    </Tooltip>
  );
}

const contentWrapperSx: SxProps<Theme> = { display: 'inline-flex', alignItems: 'center', width: 'auto', mt: 0, position: 'relative' };

const selectorSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  cursor: 'pointer',
  padding: '0rem',
  '&:hover .agents-version-text': { color: theme.vars.palette.text.createButton },
  '&:hover .agents-dropdown-icon': { color: theme.vars.palette.text.createButton },
});

const warningIconSx: SxProps<Theme> = (theme: Theme) => ({ width: '0.875rem', height: '0.875rem', color: theme.vars.palette.warning.main, mr: '0.25rem', flexShrink: 0 });

const versionTextBaseSx = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '7.5rem',
  flexShrink: 1,
} as const;

const versionTextSx: SxProps<Theme> = (theme: Theme) => ({ ...versionTextBaseSx, color: theme.vars.palette.text.primary });
const versionTextInvalidSx: SxProps<Theme> = (theme: Theme) => ({ ...versionTextBaseSx, color: theme.vars.palette.warning.main });

const dropdownIconBaseSx = { width: '1rem', height: '1rem', transition: 'transform 0.2s ease-in-out', flexShrink: 0 } as const;
const dropdownIconSx: SxProps<Theme> = (theme: Theme) => ({ ...dropdownIconBaseSx, color: theme.vars.palette.text.primary });
const dropdownIconInvalidSx: SxProps<Theme> = (theme: Theme) => ({ ...dropdownIconBaseSx, color: theme.vars.palette.warning.main });

/** Passed via `Menu`'s own `slotProps.paper.sx` (a real, documented MUI slot) instead of an outer `sx`-based `'& .MuiPaper-root'` selector — R-T6 bans `.Mui<Component>-<slot>` selectors outside `shared/brand/mui-overrides/`. */
const menuPaperSx: SxProps<Theme> = (theme: Theme) => ({
  borderRadius: theme.vars.shape.radiusMd,
  border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
  background: theme.vars.palette.background.secondary,
  boxShadow: theme.vars.palette.boxShadow.default,
  minWidth: '15rem',
  maxWidth: '17.5rem',
  maxHeight: '12.5rem',
  overflow: 'hidden',
});

/** Baseline's own `'& .MuiList-root'` override on the menu (R-T6-banned selector shape here) — carried via `Menu`'s `slotProps.list.sx` instead, mirroring `menuPaperSx`'s slot-based approach above. Without this the list has no scrollable region of its own and overflowing version entries are silently clipped by `menuPaperSx`'s `overflow: 'hidden'`. */
const menuListSx: SxProps<Theme> = {
  padding: '0 0 0.25rem',
  maxHeight: '11.5rem',
  overflowY: 'auto',
};

const versionHeaderSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.25rem 0.75rem 0.25rem 1.25rem',
  borderBottom: `0.0625rem solid ${theme.vars.palette.border.lines}`,
  minHeight: '1.75rem',
  marginBottom: '0.25rem',
});

const versionHeaderTitleSx: SxProps<Theme> = (theme: Theme) => ({ color: theme.vars.palette.text.default, textTransform: 'uppercase' });

const menuItemBaseSx = { padding: '0.5rem 1.25rem', minHeight: '2.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } as const;
const menuItemSx: SxProps<Theme> = (theme: Theme) => ({ ...menuItemBaseSx, color: theme.vars.palette.text.secondary, cursor: 'pointer' });
const selectedMenuItemSx: SxProps<Theme> = (theme: Theme) => ({ ...menuItemBaseSx, fontWeight: 500, color: theme.vars.palette.text.secondary, background: theme.vars.palette.background.conversation.selected, cursor: 'default' });

const selectedCheckIconSx: SxProps<Theme> = (theme: Theme) => ({ width: '1rem', height: '1rem', color: theme.vars.palette.text.secondary, ml: 1 });

const refreshIconStyle = { width: '0.75rem', height: '0.75rem' };
