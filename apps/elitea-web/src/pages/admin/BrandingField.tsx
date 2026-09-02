/**
 * The Branding page's inherit-aware inputs (ADR-0024 WP4).
 *
 * Every field of the `branding` section has a third state besides "set" and
 * "empty": INHERIT. An empty string or 0 tells the server to take the value
 * from the layer below — the mounted file pack, else the product default —
 * and the operator needs to see, on the field itself, what that layer would
 * supply and which layer is currently deciding. The helper text carries both,
 * so the answer to "what happens if I clear this?" is on screen before the
 * clear.
 */
import type { ReactNode } from 'react';

import TextField from '@mui/material/TextField';

import { t } from '@/shared/i18n';

import type { BrandingFieldSource, BrandingNumberKey, BrandingTextKey } from './brandingValues';

/** The layer a field's effective value comes from, as the page names it. */
export function sourceLabel(source: BrandingFieldSource): string {
  switch (source) {
    case 'database':
      return t('pages.admin.branding.source.database', 'Set here');
    case 'file':
      return t('pages.admin.branding.source.file', 'Mounted file pack');
    case 'default':
      return t('pages.admin.branding.source.default', 'Product default');
  }
}

/**
 * `<layer> · <hint>`: which layer decides, then either "clear to inherit X" for
 * a stored value or "inherits X from …" for an inherited one. `inherited` is
 * the effective pack's value for the field; an empty one (an optional field
 * nobody set) reads as "nothing".
 */
export function inheritHelperText(
  source: BrandingFieldSource,
  inherited: string,
  description?: string,
): string {
  const shown = inherited === '' ? t('pages.admin.branding.inherits.nothing', 'nothing') : `“${inherited}”`;
  const hint =
    source === 'database'
      ? `${t('pages.admin.branding.inherits.clear', 'Clear to inherit')} ${shown}`
      : `${t('pages.admin.branding.inherits.from', 'Inherits')} ${shown}`;
  const parts = [sourceLabel(source), hint];
  if (description !== undefined && description !== '') parts.push(description);
  return parts.join(' · ');
}

interface CommonFieldProps {
  readonly label: string;
  readonly description?: string;
  /** The effective pack's value — what clearing the field would leave in force. */
  readonly inherited: string;
  readonly source: BrandingFieldSource;
  /** The server's refusal, when it named this field. */
  readonly error?: string | undefined;
  readonly disabled: boolean;
}

export interface BrandingTextFieldProps extends CommonFieldProps {
  readonly fieldKey: BrandingTextKey;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly multiline?: boolean;
  readonly endAdornment?: ReactNode;
}

export function BrandingTextField({
  fieldKey,
  label,
  description,
  value,
  inherited,
  source,
  error,
  disabled,
  onChange,
  multiline = false,
  endAdornment,
}: BrandingTextFieldProps) {
  return (
    <TextField
      id={`branding-${fieldKey}`}
      size="small"
      label={label}
      value={value}
      multiline={multiline}
      disabled={disabled}
      error={error !== undefined}
      helperText={error ?? inheritHelperText(source, inherited, description)}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{
        htmlInput: { 'data-testid': `branding-field-${fieldKey}` },
        input: endAdornment === undefined ? {} : { endAdornment },
      }}
      fullWidth
    />
  );
}

export interface BrandingNumberFieldProps extends CommonFieldProps {
  readonly fieldKey: BrandingNumberKey;
  /** 0 means inherit and renders as an empty input. */
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly step?: number;
}

/**
 * A number field whose empty state is 0 — the section's own "inherit" for a
 * numeric key. An unparsable entry reads as inherit too rather than as NaN,
 * so a half-typed value never reaches the payload as something the server
 * would refuse for the wrong reason.
 */
export function BrandingNumberField({
  fieldKey,
  label,
  description,
  value,
  inherited,
  source,
  error,
  disabled,
  onChange,
  step,
}: BrandingNumberFieldProps) {
  return (
    <TextField
      id={`branding-${fieldKey}`}
      size="small"
      type="number"
      label={label}
      value={value === 0 ? '' : String(value)}
      disabled={disabled}
      error={error !== undefined}
      helperText={error ?? inheritHelperText(source, inherited, description)}
      onChange={(event) => {
        const parsed = Number.parseFloat(event.target.value);
        onChange(Number.isFinite(parsed) ? parsed : 0);
      }}
      slotProps={{
        htmlInput: {
          'data-testid': `branding-field-${fieldKey}`,
          inputMode: 'decimal',
          ...(step === undefined ? {} : { step }),
        },
      }}
      fullWidth
    />
  );
}
