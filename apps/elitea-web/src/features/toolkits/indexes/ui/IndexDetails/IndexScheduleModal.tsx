import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { BaseModal } from '@/shared/ui/BaseModal';
import { InfoTooltip } from '@/shared/ui/InfoTooltip';
import { InputBase } from '@/shared/ui/InputBase';
import { RadioButtonGroup } from '@/shared/ui/RadioButtonGroup';
import { CronField } from '@/shared/ui/cron';

import { adjustLabel } from '../../../lib/helpers/toolBase.helpers';
import { IndexCronDefault } from '../../lib/constants/indexDetails.constants';
import { validateCronExpressionDaily } from '../../lib/helpers/indexSchedule.helpers';

/**
 * Port of `apps/elitea-ui/src/[fsd]/features/toolkits/indexes/ui/
 * IndexDetails/IndexScheduleModal.jsx` (unit A4a). Structurally mirrors the
 * already-landed sibling `features/pipelines/ui/settings/
 * PipelineScheduleModal.tsx` (unit A2h) — same `BaseModal`/`RadioButtonGroup`/
 * `CronField`/`InputBase` composition, `shared/ui/cron`'s own module doc
 * comment names both baselines as its parity target. This file adds the two
 * things the pipeline modal does not need: the index-specific
 * `validateCronExpressionDaily` (daily floor, not just hourly) and the
 * credentials field.
 *
 * DISCLOSED DI (matching this program's established slot-based-composition
 * precedent — see `entities/application-form`'s `ApplicationConfigurationLayout`):
 * the baseline renders `CredentialsSelect` (`features/credentials/ui`)
 * directly. `no-sideways-features` forbids `features/toolkits` importing
 * `features/credentials` (confirmed: `.dependency-cruiser.cjs`'s rule has
 * no carve-out — same restriction already documented on this app's OWN
 * `features/credentials/ui/CredentialsSelect.tsx`, which itself cannot
 * reach into sibling features for the same reason). That component's real
 * new-app shape (`CredentialsSelectProps`: `state`/`handlers` objects built
 * from `features/credentials`'s own `useConfigurations` family) is also far
 * from "thin" — composing it requires calling hooks this slice may not
 * import either way. `renderCredentialsSelect` is therefore an injected
 * render-prop: this component owns the VALUE/error/disabled/label state (as
 * the baseline did), a caller ABOVE both `features/toolkits` and
 * `features/credentials` (a `pages/`/`widgets/` composition root, which
 * legitimately may import both) supplies the actual rendered picker.
 *
 * That supplier is `pages/toolkits/lib/credentialPickerSlots.tsx` since #308.
 * Before it, the slot travelled down four components and no production caller
 * filled it, so this modal rendered no credential field at all.
 */

export interface CredentialsSelectSlotProps {
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  readonly label: string;
  readonly configurationTypes: readonly string[];
  readonly error: boolean;
  readonly helperText: string;
  readonly disabled: boolean;
  /** Mirrors the baseline's `onlyPublic={!isPrivateProject}`. */
  readonly onlyPublic: boolean;
}

/** The subset of a toolkit's converted schema `credentials` property this modal reads (baseline: the `find(([, v]) => v.section?.includes('credentials'))` result). */
export interface CredentialsFieldDescriptor {
  readonly description?: string;
  readonly options?: readonly unknown[];
  readonly configuration_types?: readonly string[];
  /** The property's own key in the schema (`github_configuration`, ...). `IndexActions`' `resolveCredentialsData` carries it here — see `resolveCredentialsLabel` below for why the label needs it. */
  readonly propertyKey?: string;
}

/**
 * The picker's label (#308).
 *
 * The served property carries NO `description`. PR #352 states why: the pinned
 * SDK catalogue holds only a DIGEST of each configuration schema, so the
 * backend has no label to serve and cannot invent one. This field used to fall
 * back to `''`, which renders an unlabelled picker.
 *
 * The label is therefore derived on the client, from the property KEY, through
 * `adjustLabel` — the very function the toolkit form already applies to every
 * other property (`ToolBaseProperty.tsx`: `adjustLabel(schema.title || key)`).
 * `github_configuration` becomes "Github Configuration" on both surfaces.
 *
 * Two alternatives were rejected. A hand-written type-to-label map goes stale
 * the moment the SDK adds a configuration type, and nothing fails when it does
 * — the same silent-drift class of defect this issue sits under. The referenced
 * configuration's own type name (`github`) names the PROVIDER, not the field,
 * so a toolkit with two references would label both the same.
 *
 * A served `description` still wins, so the backend can take the label back
 * whenever it has one.
 */
function resolveCredentialsLabel(credentialsData: CredentialsFieldDescriptor): string {
  if (credentialsData.description !== undefined && credentialsData.description.trim() !== '') return credentialsData.description;
  if (credentialsData.propertyKey !== undefined && credentialsData.propertyKey.trim() !== '') return adjustLabel(credentialsData.propertyKey);
  return t('features.toolkits.indexScheduleModal.credentialsLabel', 'Credentials');
}

export interface IndexScheduleModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (cronExpression: string, credentials: unknown) => void;
  readonly cron?: string | undefined;
  readonly credentials?: unknown;
  readonly credentialsData?: CredentialsFieldDescriptor | null | undefined;
  readonly toolkitSchemaFetching?: boolean | undefined;
  /** Baseline: `!isPrivateProject` gate on `CredentialsSelect`'s `onlyPublic`. No "personal project" primitive exists yet anywhere in this app (see `IndexActions.tsx`'s own doc comment) — defaults to `false` (show both public and private configurations) rather than invent one. */
  readonly isPrivateProject?: boolean | undefined;
  readonly renderCredentialsSelect?: ((props: CredentialsSelectSlotProps) => ReactNode) | undefined;
}

const contentWrapperSx: SxProps<Theme> = { display: 'flex', flexDirection: 'column', gap: '1.75rem', minWidth: '25rem' };
const cronWrapperSx: SxProps<Theme> = { display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.5rem' };
const descriptionContainerSx: SxProps<Theme> = { display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: '0.25rem', gap: '0.25rem' };
/** `fontSize` is not repeated here (R-T11): `variant="bodySmall"` at the call site already renders at 0.75rem — see `shared/brand/typography.ts`'s `-1` step. */
const cronDescriptionSx: SxProps<Theme> = { color: 'text.secondary', textAlign: 'center' };

export function IndexScheduleModal(props: IndexScheduleModalProps): ReactNode {
  const {
    open,
    onClose,
    onSubmit,
    cron,
    credentials,
    credentialsData,
    toolkitSchemaFetching = false,
    isPrivateProject = false,
    renderCredentialsSelect,
  } = props;

  const [innerCredentials, setInnerCredentials] = useState<unknown>(null);
  const [credentialsError, setCredentialsError] = useState(false);
  const [cronExpression, setCronExpression] = useState(IndexCronDefault);
  const [cronType, setCronType] = useState<'default' | 'advanced'>('default');

  useEffect(() => {
    if (open) {
      if (cron) setCronExpression(cron);
      setInnerCredentials(credentials);
      return undefined;
    }
    return () => {
      setCredentialsError(false);
      setCronType('default');
    };
  }, [open, cron, credentials]);

  const cronState = useMemo(() => validateCronExpressionDaily(cronExpression), [cronExpression]);

  const applyIsDisabled = !cronState.isValid || toolkitSchemaFetching;

  const applyChanges = (): void => {
    if (!innerCredentials && credentialsData) {
      setCredentialsError(true);
      return;
    }
    onSubmit(cronExpression, innerCredentials);
    onClose();
  };

  return (
    <BaseModal
      open={open}
      onClose={onClose}
      title={t('features.toolkits.indexScheduleModal.title', 'Schedule settings')}
      content={
        <Box sx={contentWrapperSx}>
          <Box sx={cronWrapperSx}>
            {/* `CronField` (unit S7) renders its own human-readable preview
                internally — unlike the baseline's `react-js-cron`, which had
                none, so the baseline's `cronstrue`-sourced message needed
                this Typography for BOTH the preview and the error text.
                Showing `cronState.message` here unconditionally would
                duplicate CronField's own preview text; mirrors the sibling
                `PipelineScheduleModal.tsx`'s identical choice (empty on
                valid, error text only) for the same reason. */}
            <Typography
              variant="headingSmall"
              color={cronState.isValid ? 'text.secondary' : 'error'}
            >
              {cronState.isValid ? '' : cronState.message}
            </Typography>

            <RadioButtonGroup
              aria-label="Schedule type"
              value={cronType}
              items={[
                { value: 'default', label: 'Default' },
                { value: 'advanced', label: 'Advanced' },
              ]}
              onChange={(value) => setCronType(value === 'advanced' ? 'advanced' : 'default')}
            />

            {cronType === 'default' ? (
              <CronField
                value={cronExpression}
                onChange={setCronExpression}
                disabled={toolkitSchemaFetching}
              />
            ) : (
              <InputBase
                value={cronExpression}
                onChange={(event) => setCronExpression(event.target.value)}
                placeholder="* * * * *"
                error={!cronState.isValid}
                disabled={toolkitSchemaFetching}
              />
            )}

            <Box sx={descriptionContainerSx}>
              <Typography
                variant="bodySmall"
                sx={cronDescriptionSx}
              >
                minute – hour – day (month) – month – day (week)
              </Typography>
              <InfoTooltip
                title="Cron expression help"
                href="https://crontab.guru/#*_*_*_*"
              />
            </Box>

            {credentialsData &&
              renderCredentialsSelect?.({
                value: innerCredentials,
                onChange: setInnerCredentials,
                label: resolveCredentialsLabel(credentialsData),
                configurationTypes: credentialsData.configuration_types ?? [],
                error: credentialsError,
                helperText: 'Your configuration does not match any available configurations.',
                disabled: toolkitSchemaFetching,
                onlyPublic: !isPrivateProject,
              })}
          </Box>
        </Box>
      }
      actions={{ confirming: applyIsDisabled, confirmText: 'Apply', cancelText: 'Cancel' }}
      onConfirm={applyChanges}
    />
  );
}
