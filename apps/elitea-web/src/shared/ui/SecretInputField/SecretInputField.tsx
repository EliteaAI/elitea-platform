import type { ChangeEvent, ReactNode } from 'react';
import { useCallback, useState } from 'react';

import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import type { Theme } from '@mui/material/styles';
import TextField from '@mui/material/TextField';

import { OpenEyeIcon } from '../icons/open-eye-icon';
import { FieldHeader } from '../lib/field/FieldHeader';
import type { FieldMeta } from '../lib/field/jsonSchemaField.types';
import { t } from '@/shared/i18n';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface SecretInputFieldProps {
  fieldKey: string;
  value: string | undefined;
  meta: FieldMeta;
  onChange: (fieldKey: string, value: string | undefined) => void;
}

/**
 * A masked (password-style) text input with a show/hide toggle, for a
 * secret-valued tool-input field. Ported, with a deliberately reduced
 * scope, from
 * `apps/elitea-ui/src/[fsd]/shared/ui/field/SecretInputField.jsx`.
 *
 * The baseline component is a thin wrapper around
 * `shared/ui/secret-field`'s `SecretManagementInput`/`SecretField`, which
 * pull in `react-redux` (`useSelector(state => state.user)`), a live
 * `useSecretsListQuery` API call, `useCheckPermission`, and app routing —
 * to offer a SECOND tab that lets the user pick a previously-saved named
 * secret (`{{secret.NAME}}`) instead of typing a raw value. This layer's
 * LAYERING rule (props/callbacks only — no Redux, no app-level
 * hooks/context) cannot import any of that, and this unit's brief flags
 * `secret-field/` as a different unit's scope specifically to avoid a
 * cross-unit write collision, not something to reach into regardless. The
 * baseline's own call site (`SecretInputField.jsx`) additionally passes
 * `passwordVisibilityToggle` as unset — `SecretManagementInput`'s default
 * for that prop is `false` — so in practice that call site never showed
 * the baseline's own show/hide button either; the masked-value editing
 * behaviour (the part actually in reach here) is what this component
 * ports, plus a visibility toggle add — since a caller with no way to see
 * what they typed before saving is a real, avoidable usability gap, not a
 * feature to leave out.
 *
 * Dropped entirely: the saved-secret-reference tab, the refresh button, the
 * "create a new secret" link, and the secrets-list query. A caller that
 * needs those is composing a features/ or widgets/ layer component around
 * its own Redux/API access — not something `shared/ui` can offer.
 */
export function SecretInputField({ fieldKey, value, meta, onChange }: SecretInputFieldProps): ReactNode {
  const [visible, setVisible] = useState(false);
  const isEmpty = value === undefined || value === '';
  const isMissingRequired = meta.isRequired === true && isEmpty;

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const newValue = event.target.value;
      onChange(fieldKey, newValue === '' ? undefined : newValue);
    },
    [fieldKey, onChange],
  );

  const toggleVisible = useCallback(() => setVisible((prev) => !prev), []);

  const tooltipHint = isMissingRequired
    ? t('shared.ui.secretInputField.fieldRequired', 'Field is required')
    : meta.description;

  return (
    <Box
      sx={(theme: Theme) => ({ marginTop: theme.spacing(2) })}
      className="index-config-field"
    >
      <FieldHeader
        label={meta.label}
        required={meta.isRequired}
        description={tooltipHint}
      />
      <TextField
        variant="standard"
        fullWidth
        required={meta.isRequired}
        type={visible ? 'text' : 'password'}
        autoComplete="off"
        value={value ?? ''}
        onChange={handleChange}
        disabled={meta.disabled}
        error={isMissingRequired}
        slotProps={{
          htmlInput: { 'aria-label': meta.label },
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  color="tertiary"
                  size="small"
                  aria-label={
                    visible
                      ? t('shared.ui.secretInputField.hideValue', 'Hide value')
                      : t('shared.ui.secretInputField.showValue', 'Show value')
                  }
                  onClick={toggleVisible}
                >
                  {visible ? (
                    <VisibilityOffOutlinedIcon fontSize="small" />
                  ) : (
                    <OpenEyeIcon
                      width="1rem"
                      height="1rem"
                    />
                  )}
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />
    </Box>
  );
}
