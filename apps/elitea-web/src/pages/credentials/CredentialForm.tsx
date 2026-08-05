/**
 * pages/credentials/CredentialForm.tsx — the create/edit credential screen.
 * Ported from `apps/elitea-ui/src/pages/Credentials/CredentialForm.jsx`
 * (create) and `EditCredential.jsx` (edit) — the baseline splits these
 * across two thin page files around one shared body; this port keeps that
 * body as one component and lets `CreateCredential.tsx`/`EditCredential.tsx`
 * (this unit's other two page files) supply the differing `mode`.
 * Manifest ROUTE-023/024/025, ROUTE-063/064/065, COPY-465, ACT-040, ACT-041.
 *
 * DISCLOSED SCOPE (see this unit's final report for the full account):
 *  - No session/project store exists yet anywhere in this app, so
 *    `context` (project id, permissions, team-project flag) is entirely
 *    caller-supplied rather than read from a global store — the future
 *    route-wiring pass threads these from whatever R2/a later unit lands.
 *  - The per-type "data" schema is rendered with a flat field list
 *    (`CredentialSchemaField`, `./CredentialFormFields.tsx`) — the
 *    baseline's full recursive object/array `ToolBase` form renderer is
 *    the toolkits domain (A4), out of this unit's ownership fence.
 *  - The baseline's "auto-reveal the title field on an `elitea_title` API
 *    error" UX is dropped in favour of an always-editable title field —
 *    functionally equivalent (the title is always settable), a simpler
 *    interaction.
 *
 * Split across this file + `CredentialFormFields.tsx` (field widgets) +
 * `useCredentialFormController.ts` (state/mutation orchestration) purely to
 * keep every function under the §3.5 cyclomatic-complexity (≤12) and
 * file-length (≤400 lines) budgets — a single-file version of this screen
 * measured complexity 27 on the root component alone.
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';

import { CredentialsControls, CredentialsTabBar } from '@/features/credentials';

import { CredentialSchemaField } from './CredentialFormFields';
import { CredentialTypeSelector } from './CredentialTypeSelector';
import { useCredentialFormController } from './useCredentialFormController';
import type { CredentialFormContext, CredentialFormMode, CredentialFormPrefill } from './useCredentialFormController';

export type { CredentialFormContext, CredentialFormMode, CredentialFormPrefill } from './useCredentialFormController';

export interface CredentialFormProps {
  readonly context: CredentialFormContext;
  readonly mode: CredentialFormMode;
  readonly onSaved: () => void;
  readonly onDiscarded: () => void;
  readonly prefill?: CredentialFormPrefill;
  readonly onTypeChosen?: (type: string) => void;
}

export function CredentialForm(props: CredentialFormProps): ReactNode {
  const c = useCredentialFormController(props);
  const { mode, context, onDiscarded } = props;

  if (mode.kind === 'create' && !c.effectiveType) {
    return (
      <CredentialTypeSelector
        configurationsData={c.availableTypes.data}
        isFetching={c.availableTypes.isFetching}
        onSelectType={c.chooseType}
      />
    );
  }

  return (
    <Box sx={containerSx}>
      <Typography variant="headingMedium">
        {mode.configurationMode ? t('credentials.form.configurationTitle', 'Configuration') : t('credentials.form.title', 'Credential')}
      </Typography>
      <TextField
        label={t('credentials.form.nameLabel', 'Name')}
        value={c.name}
        onChange={(event) => {
          c.setName(event.target.value);
        }}
        error={Boolean(c.fieldErrors['elitea_title'])}
        helperText={c.fieldErrors['elitea_title']}
        fullWidth
        variant="standard"
      />
      {context.isTeamProject && (
        <FormControlLabel
          control={
            <Switch
              checked={c.shared}
              onChange={(event) => {
                c.setShared(event.target.checked);
              }}
            />
          }
          label={t('credentials.form.sharedLabel', 'Shared with the team')}
        />
      )}
      {Object.entries(c.schemaProperties).map(([fieldKey, property]) => (
        <CredentialSchemaField
          key={fieldKey}
          fieldKey={fieldKey}
          property={property}
          value={c.data[fieldKey]}
          error={c.fieldErrors[fieldKey]}
          onChange={c.setField}
        />
      ))}
      {c.apiError && (
        <Typography
          variant="labelSmall"
          sx={errorTextSx}
        >
          {c.apiError}
        </Typography>
      )}
      {c.typeDescriptor?.has_test_connection && <TestConnectionBlock controller={c} />}
      <Box sx={actionsRowSx}>
        <CredentialsTabBar
          isEditing={mode.kind === 'edit'}
          onSave={c.save}
          onDiscard={onDiscarded}
          canSave={c.canSave}
          isSaving={c.isSaving}
        />
        {mode.kind === 'edit' && (
          <CredentialsControls
            credentialName={c.name}
            canDelete={c.canDelete}
            isDeleting={c.isDeleting}
            onDelete={c.remove}
            {...(c.deleteDisabledReason !== undefined ? { deleteDisabledReason: c.deleteDisabledReason } : {})}
          />
        )}
      </Box>
    </Box>
  );
}

interface TestConnectionBlockProps {
  readonly controller: ReturnType<typeof useCredentialFormController>;
}

/** Split out of `CredentialForm`'s render to keep that function's complexity in budget. */
function TestConnectionBlock({ controller }: TestConnectionBlockProps): ReactNode {
  const label = controller.typeDescriptor?.check_connection_label ?? t('credentials.form.testConnection', 'Test connection');
  return (
    <Box sx={testConnectionRowSx}>
      <BaseBtn
        variant="secondary"
        disabled={controller.isTesting}
        onClick={controller.testConnection}
      >
        {label}
      </BaseBtn>
      {controller.testResult === 'success' && (
        <Typography
          variant="labelSmall"
          sx={successTextSx}
        >
          {t('credentials.form.testSuccessMessage', 'Connection successful')}
        </Typography>
      )}
      {controller.testResult === 'failure' && (
        <Typography
          variant="labelSmall"
          sx={errorTextSx}
        >
          {controller.testMessage || t('credentials.form.testFailed', 'Connection test failed')}
        </Typography>
      )}
    </Box>
  );
}

const containerSx: SxProps<Theme> = (theme: Theme) => ({ display: 'flex', flexDirection: 'column', gap: theme.spacing(2), maxWidth: '40rem' });
const actionsRowSx: SxProps<Theme> = (theme: Theme) => ({ display: 'flex', alignItems: 'center', gap: theme.spacing(1) });
const testConnectionRowSx: SxProps<Theme> = (theme: Theme) => ({ display: 'flex', alignItems: 'center', gap: theme.spacing(1) });
const errorTextSx: SxProps<Theme> = (theme: Theme) => ({ color: theme.vars.palette.status.rejected });
const successTextSx: SxProps<Theme> = (theme: Theme) => ({ color: theme.vars.palette.status.publishedText });
