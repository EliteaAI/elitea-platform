/** ROUTE-050 `/mcp-auth-callback` -> `McpAuthPage` (spec §8.1). Query params PARAM-048..051. */
import { createFileRoute, useSearch } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../-ui/RouteStatus';
import { pickParams } from '../-search/params';
import { t } from '@/shared/i18n';

function McpAuthCallbackPage() {
  const search = useSearch({ from: '/_shell/mcp-auth-callback' });
  const hasError = !!(search.error ?? (search.code && search.state));

  if (hasError) {
    const message = search.error_description
      ?? (search.error ? t('mcp.authCallback.failed', 'OAuth authorisation failed') : t('mcp.authCallback.exchangeFailed', 'Token exchange failed — please reconnect the MCP.'));
    return (
      <section role="alert" aria-live="assertive" data-testid="mcp-auth-callback-error">
        <h1>{t('mcp.authCallback.heading', 'MCP Auth Callback')}</h1>
        <p>{message}</p>
      </section>
    );
  }

  return (
    <section>
      <h1>{t('mcp.authCallback.heading', 'MCP Auth Callback')}</h1>
      <p>{t('mcp.authCallback.success', 'Authentication complete.')}</p>
    </section>
  );
}

export const Route = createFileRoute('/_shell/mcp-auth-callback')({
  validateSearch: pickParams('code', 'error', 'error_description', 'state'),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: McpAuthCallbackPage,
});
