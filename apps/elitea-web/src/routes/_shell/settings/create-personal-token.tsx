/**
 * ROUTE-066 `/settings/create-personal-token` -> `CreatePersonalToken` page.
 *
 * Form for creating a new personal access token with:
 *  - Token name (validated: alphanumeric, underscore, hyphen)
 *  - Expiration period (dropdown: never, days, weeks, hours, minutes)
 *  - Expiration value (number input, shown when period != never)
 *  - Generated token display via `GeneratedTokenDialog` on success
 *
 * Ported from `apps/elitea-ui/src/[fsd]/pages/settings/CreatePersonalToken.jsx`.
 *
 * Deviations:
 *  - Uses react-hook-form + zod (project standards; formik/yup not installed)
 *  - No `useNavBlocker` hook (Wave-2 concern)
 *  - No Redux
 *  - Uses `@/shared/ui/lib/t` for i18n
 *  - Uses `DrawerPageHeader` from shared UI
 *  - Uses `GeneratedTokenDialog` from shared UI
 *  - Uses RTK Query hooks from `entities/token/api/tokenApi`
 */
import { useCallback, useMemo, useState } from 'react';

import { useForm } from 'react-hook-form';
import * as z from 'zod';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { useNavigate } from '@tanstack/react-router';

import { DrawerPageHeader } from '@/shared/ui/settings/DrawerPageHeader';
import { GeneratedTokenDialog } from '@/routes/_shell/settings/personal-tokens/GeneratedTokenDialog';
import { t } from '@/shared/ui/lib/t';
import { TOKEN_NAME_PATTERN, MAX_TOKEN_NAME_LENGTH } from '@/entities/token/model/constants';
import {
  TOKEN_EXPIRATION_OPTIONS,
  DEFAULT_TOKEN_EXPIRATION_VALUE,
} from '@/entities/token/model/constants';
import { useCreateTokenMutation, useListTokensQuery } from '@/entities/token/api/tokenApi';

/* ── zod validation schema ─────────────────────────────────────────────── */

const validationSchema = z.object({
  name: z
    .string()
    .min(1, t('entities.token.form.nameRequired', 'Name is required'))
    .max(MAX_TOKEN_NAME_LENGTH)
    .refine((v) => TOKEN_NAME_PATTERN.test(v), {
      message: t('entities.token.form.namePattern', 'Only alphanumeric characters, underscore and hyphen are allowed'),
    }),
  measure: z.string().min(1),
  expiration: z.coerce.number().min(1).optional(),
});

type FormValues = z.infer<typeof validationSchema>;

/* ── page ─────────────────────────────────────────────────────────────── */

export function CreatePersonalTokenPage() {
  const navigate = useNavigate();
  const [showDialog, setShowDialog] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<{
    token: string;
    name: string;
  }>({ token: '', name: '' });
  const createMutation = useCreateTokenMutation();
  const isGenerating = createMutation.isPending;
  useListTokensQuery({ enabled: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const form = useForm<FormValues>({
    defaultValues: {
      name: '',
      measure: 'days',
      expiration: DEFAULT_TOKEN_EXPIRATION_VALUE,
    },
  });

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isValid },
  } = form;

  const measure = watch('measure');
  const name = watch('name');

  const onSubmit = useCallback(async (values: FormValues) => {
    const expires =
      values.measure === 'never'
        ? null
        : { measure: values.measure, value: values.expiration ?? DEFAULT_TOKEN_EXPIRATION_VALUE };

    try {
      const resp = await createMutation.mutateAsync({
        name: values.name,
        expires,
      });
      setGeneratedToken({ token: resp.token, name: resp.name });
      setShowDialog(true);
    } catch {
      // Error handled by react-query — no toast in shared/ui
    }
  }, [createMutation]);

  const hasChanged = useMemo(() => {
    return name !== '' || measure !== 'days' || watch('expiration') !== DEFAULT_TOKEN_EXPIRATION_VALUE;
  }, [name, measure, watch('expiration')]);

  const onCancel = useCallback(() => {
    void navigate({ to: '/settings/tokens' });
  }, [navigate]);

  const nameError = errors.name?.message;
  const isAtCharacterLimit = name.length >= MAX_TOKEN_NAME_LENGTH;

  const isGenerateDisabled = !isValid || isGenerating || !hasChanged;

  const styles = getStyles();

  return (
    <>
      <Paper
        elevation={0}
        sx={styles.root}
      >
        <DrawerPageHeader
          title={t('entities.token.form.pageTitle', 'New Token')}
          showBackButton
          onBack={onCancel}
          extraContent={
            <Box sx={styles.headerRight}>
              <Button
                variant="elitea"
                color="primary"
                disabled={isGenerateDisabled}
                onClick={handleSubmit(onSubmit)}
              >
                {t('entities.token.form.generate', 'Generate')}
                {isGenerating && (
                  <CircularProgress
                    size={16}
                    sx={styles.loadingIndicator}
                  />
                )}
              </Button>
              <Button
                variant="outlined"
                color="secondary"
                disabled={isGenerating || !hasChanged}
                onClick={onCancel}
              >
                {t('entities.token.form.discard', 'Discard')}
              </Button>
            </Box>
          }
        />
        <Box sx={styles.content}>
          <Box sx={styles.formWrapper}>
            <form onSubmit={handleSubmit(onSubmit)}>
              <Box sx={styles.formFields}>
                {/* Name field */}
                <Box sx={styles.nameField}>
                  <input
                    style={styles.input}
                    id="name"
                    {...register('name')}
                    placeholder={t('entities.token.form.name', 'Name')}
                    maxLength={MAX_TOKEN_NAME_LENGTH}
                    aria-label={t('entities.token.form.name', 'Name')}
                  />
                  {nameError && (
                    <Typography
                      variant="bodySmall"
                      color="error"
                      sx={styles.helperText}
                    >
                      {nameError}
                    </Typography>
                  )}
                  {isAtCharacterLimit && !nameError && (
                    <Typography
                      variant="bodySmall"
                      color="text.secondary"
                      sx={styles.helperText}
                    >
                      {t('entities.token.form.charLimit', `Maximum character limit reached (${MAX_TOKEN_NAME_LENGTH})`)}
                    </Typography>
                  )}
                </Box>

                {/* Expiration row */}
                <Box sx={styles.expirationRow}>
                  <Box sx={styles.measureField}>
                    <select
                      id="measure"
                      {...register('measure')}
                      style={styles.select}
                      aria-label={t('entities.token.form.expirationPeriod', 'Expiration period')}
                    >
                      {TOKEN_EXPIRATION_OPTIONS.map((opt) => (
                        <option
                          key={opt.value}
                          value={opt.value}
                        >
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </Box>
                  {measure !== 'never' && (
                    <Box sx={styles.valueField}>
                      <input
                        style={styles.numberInput}
                        id="expiration"
                        type="number"
                        {...register('expiration')}
                        min={1}
                        aria-label={t('entities.token.form.expirationValue', 'Value')}
                      />
                    </Box>
                  )}
                </Box>
              </Box>
            </form>
          </Box>
        </Box>
      </Paper>

      <GeneratedTokenDialog
        open={showDialog}
        token={generatedToken.token}
        name={generatedToken.name}
        onClose={() => {
          setShowDialog(false);
          onCancel();
        }}
      />
    </>
  );
}

const getStyles = (): {
  root: SxProps<Theme>;
  headerRight: SxProps<Theme>;
  content: SxProps<Theme>;
  formWrapper: SxProps<Theme>;
  formFields: SxProps<Theme>;
  nameField: SxProps<Theme>;
  expirationRow: SxProps<Theme>;
  measureField: SxProps<Theme>;
  valueField: SxProps<Theme>;
  loadingIndicator: SxProps<Theme>;
  input: React.CSSProperties;
  select: React.CSSProperties;
  numberInput: React.CSSProperties;
  helperText: SxProps<Theme>;
} => {
  const baseInput: React.CSSProperties = {
    width: '100%',
    border: 'none',
    borderBottom: '1px solid',
    borderBottomColor: 'rgba(0,0,0,0.12)',
    padding: '0.5rem 0',
    fontSize: '1rem',
    outline: 'none',
    background: 'transparent',
  };

  return {
    root: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    },
    headerRight: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
    },
    content: {
      padding: '1.5rem',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'flex-start',
      flex: 1,
    },
    formWrapper: {
      marginTop: '1.25rem',
      width: '100%',
      maxWidth: '45rem',
    },
    formFields: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '1.25rem',
    },
    nameField: {
      width: '17.875rem',
    },
    expirationRow: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: '1rem',
      width: '17.875rem',
    },
    measureField: {
      width: '12.5rem',
    },
    valueField: {
      width: '5.375rem',
      paddingTop: '0.125rem',
    },
    loadingIndicator: {
      marginLeft: '0.5rem',
    },
    input: baseInput,
    select: {
      ...baseInput,
      cursor: 'pointer',
      appearance: 'auto',
    },
    numberInput: {
      ...baseInput,
      width: '100%',
      textAlign: 'center',
    },
    helperText: {
      marginTop: '0.25rem',
      fontSize: '0.75rem',
    },
  };
};
