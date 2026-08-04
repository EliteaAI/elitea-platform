/**
 * ui/CredentialsSelect.tsx — a labelled dropdown for attaching a saved
 * credential (or creating a new one) to a toolkit/agent/model-config field.
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/credentials/ui/credentials-select/CredentialsSelect.jsx`.
 * Manifest COPY-113, ACT-041 (test-connection-via-onRevalidate).
 *
 * DISCLOSED REDESIGN, forced by real API differences in components this
 * unit does not own:
 *  - `shared/ui/SingleSelect` (unit S1-D) takes `label: string` only per
 *    option (see `SingleSelectMenuItem.tsx`) — deliberately trimmed, no
 *    rich-node option content, no grouped sections with sticky headers, no
 *    `headerEnd` popup slot (see that component's own doc comment). This
 *    component's rows need `CredentialOptionLabel`'s icon + inline actions,
 *    which a plain string cannot carry. Built directly on MUI
 *    `Select`/`MenuItem` instead — the SAME escape hatch
 *    `shared/ui/SecretField.tsx`'s own `SecretSelect` already uses for
 *    exactly this reason (rich per-option content a trimmed shared
 *    component can't express), not a new pattern invented here.
 *  - GA analytics (`useTrackEvent`) and the MCP-token silent-unlock check
 *    (`McpAuthHelpers.loadTokens()`) are dropped — both are cross-domain
 *    concerns (`shared/lib/constants/analytic.constants`, the `mcp`
 *    feature slice) this unit may not import into (R-L1: sibling
 *    `features/*` slices do not import each other).
 *  - There is no session/project store yet anywhere in this app (see this
 *    unit's final report) — `selectedProjectId`/`personal_project_id`/the
 *    "open in new tab" URL and "create" navigation are all caller-supplied
 *    instead of read from Redux/`RouteDefinitions`.
 *  - The `vectorstorage`-section auto-select-project-default special case
 *    is out of scope (that behaviour is the settings/AI-configuration
 *    domain, unit A9); only the `credentials`-section auto-select (first
 *    shared row when the value is blank) is ported, and only as the
 *    `autoSelectFirstShared` opt-in flag a caller can set.
 *
 * **STATUS (A7-ui adversarial-review finding): zero live call sites**,
 * despite this component + sub-parts being fully built, exported, and
 * tested. Architectural, not fixable from this file: the one prospective
 * consumer (`ToolBaseProperty.tsx`'s `type === 'configuration'` branch)
 * cannot import this directly (`no-sideways-features` — R-L1); it threads
 * an opaque `slots.renderCredentialLikeField` (`CredentialLikeFieldContext`
 * in `features/toolkits/ui/form/ToolBase/types.ts`) that has zero
 * implementations anywhere in the worktree. Routing for whoever lands the
 * fix: a page/widget composition root (none exists yet) that may legally
 * import both `features/toolkits` and `features/credentials` must supply
 * that slot, rendering `<CredentialsSelect>` for `kind === 'configuration'`
 * from `context.value`/`onChange`/`propertyKey`/`presetOptions`/
 * `onCredentialReload`. Out of this cluster's scope (`features/toolkits`
 * and any new page/widget file are outside A7-ui's file scope).
 */
import { useCallback, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';

import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Tooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { RefreshIcon } from '@/shared/ui/icons/refresh-icon';
import { BUTTON_VARIANTS, BaseBtn } from '@/shared/ui/BaseBtn';

import {
  decodeCreateActionValue,
  decodeSavedCredentialValue,
  encodeCreateActionValue,
  encodeSavedCredentialValue,
  isBlankEliteaTitle,
} from '../lib/credentialSelectValue';

import { CredentialCreateLabel } from './CredentialCreateLabel';
import { CredentialMismatchFooter } from './CredentialMismatchFooter';
import { CredentialNotFoundValue } from './CredentialNotFoundValue';
import { CredentialOptionLabel } from './CredentialOptionLabel';

export interface CredentialOptionRow {
  readonly eliteaTitle: string;
  readonly isPrivate: boolean;
  readonly displayLabel: string;
  readonly credentialUrl?: string;
  readonly shared?: boolean;
}

export interface CredentialsSelectValue {
  readonly eliteaTitle: string;
  readonly isPrivate: boolean;
}

export interface CredentialsSelectState {
  readonly configurations: readonly CredentialOptionRow[];
  readonly hasFetchedData: boolean;
  readonly isFetching: boolean;
  readonly getStatus: (eliteaTitle: string) => 'idle' | 'checking' | 'valid' | 'invalid' | 'unsupported';
  readonly getMessage: (eliteaTitle: string) => string;
}

export interface CredentialsSelectHandlers {
  readonly onSelect: (value: CredentialsSelectValue | null, meta: { isAutoSelect: boolean }) => void;
  readonly onRefresh: () => void;
  readonly onCreate: (isPrivate: boolean) => void;
  readonly onRevalidate: (eliteaTitle: string) => void;
}

export interface CredentialsSelectFieldProps {
  readonly label?: string;
  readonly required?: boolean;
  readonly error?: boolean;
  readonly helperText?: string;
  readonly disabled?: boolean;
}

export interface CredentialsSelectMismatchProps {
  readonly mismatchedPrivateCredential: boolean;
  readonly createHref: string;
}

export interface CredentialsSelectProps {
  readonly value: CredentialsSelectValue | null;
  readonly state: CredentialsSelectState;
  readonly handlers: CredentialsSelectHandlers;
  readonly field?: CredentialsSelectFieldProps;
  readonly type?: string;
  readonly isCreationAllowed?: boolean;
  readonly mismatch?: CredentialsSelectMismatchProps;
  /** Old-app `credentials`-section auto-select behaviour: select the first saved row once loaded, if `value` is still blank. */
  readonly autoSelectFirstShared?: boolean;
}

export function CredentialsSelect({
  value,
  state,
  handlers,
  field,
  type,
  isCreationAllowed = true,
  mismatch,
  autoSelectFirstShared = false,
}: CredentialsSelectProps): ReactNode {
  const { configurations, hasFetchedData, isFetching, getStatus, getMessage } = state;

  const selectedRow = useMemo(
    () => configurations.find((row) => row.eliteaTitle === value?.eliteaTitle && row.isPrivate === value?.isPrivate),
    [configurations, value],
  );

  const hasAutoSelectedRef = useRef(false);
  useEffect(() => {
    autoSelectFirstSharedRow({ autoSelectFirstShared, hasFetchedData, hasAutoSelectedRef, value, configurations, onSelect: handlers.onSelect });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per mount when data first arrives, matching the baseline's `hasAutoSelectedRef` guard.
  }, [autoSelectFirstShared, hasFetchedData, configurations]);

  const selectStringValue = useMemo(() => {
    if (!hasFetchedData) return '';
    if (selectedRow) return encodeSavedCredentialValue({ eliteaTitle: selectedRow.eliteaTitle, isPrivate: selectedRow.isPrivate });
    return '';
  }, [hasFetchedData, selectedRow]);

  const handleChange = useCallback(
    (event: SelectChangeEvent<string>) => {
      const nextValue = event.target.value;
      const created = decodeCreateActionValue(nextValue);
      if (created) {
        handlers.onCreate(created.isPrivate);
        return;
      }
      const saved = decodeSavedCredentialValue(nextValue);
      if (!saved) return;
      const isSame = value?.eliteaTitle === saved.eliteaTitle && value?.isPrivate === saved.private;
      handlers.onSelect(isSame ? null : { eliteaTitle: saved.eliteaTitle, isPrivate: saved.private }, { isAutoSelect: false });
    },
    [handlers, value],
  );

  const resolvedField = resolveFieldProps(field);
  const showMismatchFooter = isMismatchFooterVisible(value, selectedRow, hasFetchedData);

  return (
    <Box sx={containerSx}>
      <Box sx={fieldRowSx}>
        <FormControl
          variant="standard"
          fullWidth
          size="small"
          required={resolvedField.required}
          disabled={resolvedField.disabled}
          error={resolvedField.error}
        >
          <InputLabel shrink>{resolvedField.label}</InputLabel>
          <Select<string>
            value={selectStringValue}
            onChange={handleChange}
            displayEmpty
            renderValue={() => renderSelectedValue(selectedRow, value, hasFetchedData)}
          >
            {isCreationAllowed && renderCreateMenuItems(type)}
            {configurations.map((row) =>
              buildSavedRowMenuItem({
                row,
                value,
                status: getStatus(row.eliteaTitle),
                message: getMessage(row.eliteaTitle),
                onSelect: handlers.onSelect,
                onRevalidate: handlers.onRevalidate,
              }),
            )}
          </Select>
          {resolvedField.helperText !== undefined && <FormHelperText>{resolvedField.helperText}</FormHelperText>}
        </FormControl>
        <Tooltip
          title={t('credentials.select.refresh', 'Refresh the configurations')}
          placement="top"
        >
          <BaseBtn
            data-testid="credentials-select-refresh"
            variant={BUTTON_VARIANTS.secondary}
            size="small"
            disabled={isFetching}
            onClick={handlers.onRefresh}
          >
            <RefreshIcon />
          </BaseBtn>
        </Tooltip>
      </Box>
      {showMismatchFooter && mismatch && renderMismatchFooter(mismatch, value, type)}
    </Box>
  );
}

interface AutoSelectFirstSharedParams {
  readonly autoSelectFirstShared: boolean;
  readonly hasFetchedData: boolean;
  readonly hasAutoSelectedRef: RefObject<boolean>;
  readonly value: CredentialsSelectValue | null;
  readonly configurations: readonly CredentialOptionRow[];
  readonly onSelect: CredentialsSelectHandlers['onSelect'];
}

/** The old-app `credentials`-section auto-select-first-row effect, split into its own function (§3.5 complexity budget) — see `CredentialsSelectProps.autoSelectFirstShared`'s doc comment. */
function autoSelectFirstSharedRow(params: AutoSelectFirstSharedParams): void {
  const { autoSelectFirstShared, hasFetchedData, hasAutoSelectedRef, value, configurations, onSelect } = params;
  if (!autoSelectFirstShared || !hasFetchedData || hasAutoSelectedRef.current) return;
  if (value && !isBlankEliteaTitle(value.eliteaTitle)) return;
  const first = configurations[0];
  if (!first) return;
  hasAutoSelectedRef.current = true;
  onSelect({ eliteaTitle: first.eliteaTitle, isPrivate: first.isPrivate }, { isAutoSelect: true });
}

interface ResolvedFieldProps {
  readonly label: string;
  readonly required: boolean | undefined;
  readonly disabled: boolean | undefined;
  readonly error: boolean | undefined;
  readonly helperText: string | undefined;
}

/** Resolves the optional `field` prop bundle to concrete values up front, so the render body reads plain fields instead of repeated `?.`/`??` chains (§3.5 complexity budget). */
function resolveFieldProps(field: CredentialsSelectFieldProps | undefined): ResolvedFieldProps {
  return {
    label: field?.label ?? t('credentials.select.defaultLabel', 'Credentials'),
    required: field?.required,
    disabled: field?.disabled,
    error: field?.error,
    helperText: field?.helperText,
  };
}

/** True once a non-blank value matches no loaded row (§3.5 complexity budget — kept out of the render body). */
function isMismatchFooterVisible(value: CredentialsSelectValue | null, selectedRow: CredentialOptionRow | undefined, hasFetchedData: boolean): boolean {
  return Boolean(value && !isBlankEliteaTitle(value.eliteaTitle) && !selectedRow && hasFetchedData);
}

function renderMismatchFooter(mismatch: CredentialsSelectMismatchProps, value: CredentialsSelectValue | null, type: string | undefined): ReactNode {
  return (
    <CredentialMismatchFooter
      mismatchedPrivateCredential={mismatch.mismatchedPrivateCredential}
      {...(value?.eliteaTitle !== undefined ? { credentialId: value.eliteaTitle } : {})}
      {...(type !== undefined ? { credentialType: type } : {})}
      createHref={mismatch.createHref}
    />
  );
}

function renderSelectedValue(
  selectedRow: CredentialOptionRow | undefined,
  value: CredentialsSelectValue | null,
  hasFetchedData: boolean,
): ReactNode {
  if (selectedRow) return selectedRow.displayLabel;
  if (value && !isBlankEliteaTitle(value.eliteaTitle)) {
    return (
      <CredentialNotFoundValue
        eliteaTitle={value.eliteaTitle}
        isPrivate={value.isPrivate}
        hasFetchedData={hasFetchedData}
      />
    );
  }
  return null;
}

/**
 * The two "create new …" rows — split out of `CredentialsSelect` to keep
 * that function's cyclomatic complexity within the §3.5 budget. Returns a
 * plain array, NOT a `<>...</>` Fragment: MUI's `Select` walks
 * `props.children` directly (`Children.map`/`cloneElement` per child) to
 * find `MenuItem`s, and a Fragment wrapping them is opaque to that walk —
 * confirmed empirically (wrapping in a Fragment silently broke both
 * `onChange` selection and the create-action click in this component's own
 * tests, even though the items still rendered visually).
 */
function renderCreateMenuItems(type: string | undefined): ReactNode[] {
  return [
    <MenuItem
      key="create-private"
      value={encodeCreateActionValue(true)}
    >
      <CredentialCreateLabel
        isPrivate
        {...(type !== undefined ? { type } : {})}
      />
    </MenuItem>,
    <MenuItem
      key="create-project"
      value={encodeCreateActionValue(false)}
    >
      <CredentialCreateLabel
        isPrivate={false}
        {...(type !== undefined ? { type } : {})}
      />
    </MenuItem>,
  ];
}

interface SavedRowMenuItemProps {
  readonly row: CredentialOptionRow;
  readonly value: CredentialsSelectValue | null;
  readonly status: ReturnType<CredentialsSelectState['getStatus']>;
  readonly message: string;
  readonly onSelect: CredentialsSelectHandlers['onSelect'];
  readonly onRevalidate: CredentialsSelectHandlers['onRevalidate'];
}

/**
 * One saved-credential row — split out of `CredentialsSelect` for the same
 * complexity-budget reason as `renderCreateMenuItems`. A plain function
 * that RETURNS a `<MenuItem>` (called directly inside `.map()`, never
 * rendered as `<SavedRowMenuItem />`) — NOT a React component: MUI's
 * `Select` walks `props.children` for literal `MenuItem` elements, and a
 * wrapping custom component is opaque to that walk (confirmed empirically,
 * same class of bug `renderCreateMenuItems`'s doc comment records for a
 * Fragment; a wrapping component breaks it identically since neither is a
 * `MenuItem` at the `Select`'s own children level). Owns the
 * click-to-deselect `onClick` (see its own inline comment: MUI's `Select`
 * suppresses `onChange` on a same-value reselect, so this restores the
 * baseline's explicit toggle for exactly that one case).
 */
function buildSavedRowMenuItem({ row, value, status, message, onSelect, onRevalidate }: SavedRowMenuItemProps): ReactNode {
  const isCurrentlySelected = value?.eliteaTitle === row.eliteaTitle && value.isPrivate === row.isPrivate;
  return (
    <MenuItem
      key={`${row.eliteaTitle}-${String(row.isPrivate)}`}
      value={encodeSavedCredentialValue({ eliteaTitle: row.eliteaTitle, isPrivate: row.isPrivate })}
      onClick={
        isCurrentlySelected
          ? () => {
              onSelect(null, { isAutoSelect: false });
            }
          : undefined
      }
    >
      <CredentialOptionLabel
        isPersonal={row.isPrivate}
        label={row.displayLabel}
        {...(row.credentialUrl !== undefined ? { credentialUrl: row.credentialUrl } : {})}
        isInvalid={status === 'invalid'}
        isChecking={status === 'checking'}
        invalidMessage={message}
        onRevalidate={(event) => {
          event.stopPropagation();
          onRevalidate(row.eliteaTitle);
        }}
      />
    </MenuItem>
  );
}

const containerSx: SxProps<Theme> = (theme: Theme) => ({ marginTop: theme.spacing(1), display: 'flex', flexDirection: 'column', gap: theme.spacing(1) });
const fieldRowSx: SxProps<Theme> = (theme: Theme) => ({ display: 'flex', alignItems: 'flex-end', gap: theme.spacing(1) });
