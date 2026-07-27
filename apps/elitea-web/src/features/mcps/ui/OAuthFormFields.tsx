/**
 * Port of
 * apps/elitea-ui/src/[fsd]/features/mcp/ui/modal/OAuthFormFields.jsx
 * (unit A5). Client ID / Client secret / Scope inputs plus an optional
 * "remember credentials" checkbox, shown conditionally per
 * `McpAuthModal`'s flow-detection logic.
 */
import type { ReactNode } from 'react';

import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { BaseCheckbox } from '@/shared/ui/BaseCheckbox';
import { InfoTooltip } from '@/shared/ui/InfoTooltip';
import { StyledInputEnhancer } from '@/shared/ui/StyledInputEnhancer';

export interface OAuthFormFieldsProps {
  clientId: string;
  clientSecret: string;
  scope: string;
  onClientIdChange: (value: string) => void;
  onClientSecretChange: (value: string) => void;
  onScopeChange: (value: string) => void;
  availableScopes?: readonly string[];
  needClientId?: boolean;
  needSecret?: boolean;
  saveCredentials?: boolean;
  onSaveCredentialsChange: (checked: boolean) => void;
  showSaveCredentials?: boolean;
}

export function OAuthFormFields({
  clientId,
  clientSecret,
  scope,
  onClientIdChange,
  onClientSecretChange,
  onScopeChange,
  availableScopes = [],
  needClientId = false,
  needSecret = false,
  saveCredentials = false,
  onSaveCredentialsChange,
  showSaveCredentials = false,
}: OAuthFormFieldsProps): ReactNode {
  return (
    <>
      {needClientId && (
        <StyledInputEnhancer
          autoComplete="off"
          label={t('mcps.oauthForm.clientIdLabel', 'Client ID')}
          placeholder={t('mcps.oauthForm.clientIdPlaceholder', 'Enter OAuth client ID from the provider')}
          onChange={(event) => onClientIdChange(event.target.value)}
          value={clientId}
          required
        />
      )}
      {needSecret && (
        <StyledInputEnhancer
          autoComplete="off"
          label={t('mcps.oauthForm.clientSecretLabel', 'Client Secret')}
          placeholder={t('mcps.oauthForm.clientSecretPlaceholder', 'Enter OAuth client secret')}
          onChange={(event) => onClientSecretChange(event.target.value)}
          value={clientSecret}
          type="password"
          required
        />
      )}
      <StyledInputEnhancer
        autoComplete="off"
        label={
          <Typography
            variant="bodyMedium"
            color="text.primary"
            sx={{ display: 'flex', alignItems: 'center' }}
          >
            {t('mcps.oauthForm.scopeLabel', 'Scope (optional)')}
            {availableScopes.length > 0 && (
              <InfoTooltip
                title={t('mcps.oauthForm.scopeTooltip', 'MCP server supports: {{scopes}}.', { scopes: availableScopes.join(', ') })}
                sx={{ display: 'inline-flex', alignItems: 'center', marginLeft: '0.25rem', color: 'text.secondary', cursor: 'default' }}
              />
            )}
          </Typography>
        }
        onChange={(event) => onScopeChange(event.target.value)}
        value={scope}
        placeholder={t('mcps.oauthForm.scopePlaceholder', 'Enter OAuth scopes (space-separated)')}
      />
      {showSaveCredentials && (
        <FormControlLabel
          control={
            <BaseCheckbox
              checked={saveCredentials}
              onChange={(_event, checked) => onSaveCredentialsChange(checked)}
            />
          }
          label={
            <Typography
              variant="bodyMedium"
              color="text.primary"
            >
              {t('mcps.oauthForm.rememberCredentials', 'Remember credentials for this session')}
            </Typography>
          }
          sx={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}
        />
      )}
    </>
  );
}
