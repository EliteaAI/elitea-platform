import type { MouseEvent, ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import CheckIcon from '@mui/icons-material/Check';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { isSetDefaultDisabled } from '@/entities/version';
import { t } from '@/shared/i18n';
import { combineSx } from '@/shared/ui/lib/combineSx';
import { RefreshIcon } from '@/shared/ui/icons/refresh-icon';

import type { AgentPipelineVersionOption } from '../lib/types';

import {
  contentWrapperSx,
  defaultMarkerSx,
  dropdownIconInvalidSx,
  dropdownIconSx,
  menuItemSx,
  menuListSx,
  menuPaperSx,
  refreshIconStyle,
  rowEndSx,
  selectedCheckIconSx,
  selectedMenuItemSx,
  selectorSx,
  setDefaultIconSx,
  setDefaultItemSx,
  versionHeaderSx,
  versionHeaderTitleSx,
  versionTextInvalidSx,
  versionTextSx,
  warningIconSx,
} from './AgentPipelineVersionSelector.styles';

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
  /**
   * #147 — the "set as default" item, baseline `entities/version/lib/
   * helpers/version.helpers.jsx:11-84` + `ApplicationVersionSelect.jsx:36,
   * 239`. It acts on the version the menu currently marks as selected, and
   * the row that IS the default carries a "Default" marker.
   *
   * **Deliberately one command item, not a pin button on every row.** The
   * baseline puts an `onClick` pin INSIDE each option row. Here each row is
   * a `MenuItem` (`role="menuitem"`, a widget role), so a button inside one
   * is axe's `nested-interactive` — impact "serious", and a rule the E2E
   * `checkA11y` fixture does NOT disable. `secondaryAction`, MUI's answer
   * for the same problem in `features/artifacts`' `BucketSidebar`, exists on
   * `ListItem` and not on `MenuItem`. A command item reaches every version
   * in the same two steps (pick the version, then pin it), stays reachable
   * from the keyboard, and needs no ARIA exception. The baseline's pin is
   * also revealed on row HOVER only, which no keyboard user and no journey
   * test can reach — that is a large part of why #147 stayed invisible.
   *
   * Caller-owned, like `onSelectVersion`: this component opens no dialog and
   * sends no request, it only reports which version was picked. Omit
   * `onSetDefaultVersion` and the item is not rendered at all — that is how
   * the read-only viewer and the tool card (`ToolCardBody`) keep the plain
   * version list they had.
   */
  readonly defaultVersionId?: number | undefined;
  readonly onSetDefaultVersion?: ((version: AgentPipelineVersionOption) => void) | undefined;
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

/**
 * #147's command item — see the `onSetDefaultVersion` prop doc for why the
 * affordance is one item here and a per-row pin in the baseline.
 *
 * Eligibility is `entities/version`'s promoted `isSetDefaultDisabled`, whose
 * own doc comment cites the baseline's `disableSetAsADefault` (already the
 * default, no default recorded yet and this is the "base" fallback, or the
 * version is published). That selector was written for `VersionSummary`
 * (string ids, from the normalised entity layer) and this menu's option
 * carries a numeric id, so the row is ADAPTED rather than the rule copied —
 * a second, drifting definition of "which versions may be pinned" is
 * exactly the cost this app has already paid elsewhere.
 */
function renderSetDefaultItem(params: {
  selectedVersion: DisplayVersion | undefined;
  defaultVersionId: number | undefined;
  onSetDefaultVersion: ((version: AgentPipelineVersionOption) => void) | undefined;
}): ReactNode {
  const { selectedVersion, defaultVersionId, onSetDefaultVersion } = params;
  if (onSetDefaultVersion === undefined || selectedVersion === undefined) return null;
  const disabled = isSetDefaultDisabled(
    {
      id: String(selectedVersion.id),
      name: selectedVersion.name,
      status: selectedVersion.status ?? '',
      agentType: '',
      createdAt: selectedVersion.created_at ?? '',
    },
    defaultVersionId === undefined ? undefined : String(defaultVersionId),
  );
  return (
    <MenuItem
      data-testid="agent-version-set-default"
      disabled={disabled}
      onClick={() => onSetDefaultVersion(selectedVersion)}
      sx={setDefaultItemSx}
    >
      <PushPinOutlinedIcon sx={setDefaultIconSx} />
      <Typography variant="bodyMedium">{t('agents.versionSelector.setDefault', 'Set as default')}</Typography>
    </MenuItem>
  );
}

function renderMenu(params: {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  isRefreshingVersions: boolean;
  onRefresh: (event: MouseEvent) => void;
  displayVersions: readonly DisplayVersion[];
  selectedVersion: DisplayVersion | undefined;
  onVersionClick: (version: DisplayVersion) => () => void;
  defaultVersionId: number | undefined;
  onSetDefaultVersion: ((version: AgentPipelineVersionOption) => void) | undefined;
}): ReactNode {
  const { anchorEl, onClose, isRefreshingVersions, onRefresh, displayVersions, selectedVersion, onVersionClick } = params;
  const { defaultVersionId, onSetDefaultVersion } = params;
  const selectedVersionId = selectedVersion?.id;
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
            <Box sx={rowEndSx}>
              {version.id === defaultVersionId && (
                <Typography
                  variant="labelSmall"
                  data-testid="agent-version-default-marker"
                  sx={defaultMarkerSx}
                >
                  {t('agents.versionSelector.defaultMarker', 'Default')}
                </Typography>
              )}
              {isSelected && <CheckIcon sx={selectedCheckIconSx} />}
            </Box>
          </MenuItem>
        );
      })}

      {renderSetDefaultItem({ selectedVersion, defaultVersionId, onSetDefaultVersion })}
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
  defaultVersionId,
  onSetDefaultVersion,
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

  /*
   * #147 — the menu closes BEFORE the caller is told. The caller answers this
   * with a confirm dialog, and leaving an open `Menu` behind it stacks two
   * focus traps: the dialog takes focus, `Escape` then closes whichever the
   * browser considers topmost, and a keyboard user can end up inside a menu
   * they cannot see past the modal.
   */
  const handleSetDefaultClick = useCallback(
    (version: AgentPipelineVersionOption) => {
      setAnchorEl(null);
      onSetDefaultVersion?.(version);
    },
    [onSetDefaultVersion],
  );

  const content = (
    <Box sx={contentWrapperSx}>
      {renderTrigger({ displayText, isInvalid: isInvalidVersionReference, isSwitching: isSwitchingVersion, disabled, isOpen: !!anchorEl, onClick: handleClick })}
      {renderMenu({
        anchorEl,
        onClose: handleClose,
        isRefreshingVersions,
        onRefresh: handleRefresh,
        displayVersions,
        selectedVersion,
        onVersionClick: handleVersionClick,
        defaultVersionId,
        onSetDefaultVersion: onSetDefaultVersion === undefined ? undefined : handleSetDefaultClick,
      })}
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
