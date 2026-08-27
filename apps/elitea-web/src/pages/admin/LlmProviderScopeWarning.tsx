/**
 * Does the gateway actually read what the Providers tab publishes?
 *
 * Its own file because it is the one thing on that screen that reports a fact
 * about ANOTHER SERVICE, and because it is the check most likely to be deleted
 * by someone tidying "an alert that never fires" — it does not fire on a healthy
 * deployment, which is the point.
 */
import type { ReactNode } from 'react';

import Alert from '@mui/material/Alert';

import { t } from '@/shared/i18n';

import { useGatewayStatus } from './api/adminLlmProxyApi';

/**
 * Whether the gateway will actually read what this screen publishes.
 *
 * THE FAILURE THIS PREVENTS is silent and total. elitea-main writes a platform
 * credential into `p_{public project}`; the gateway resolves shared credentials
 * out of `p_{its own configured project}`. The two are separate settings in
 * separate services — and until this change they were separate environment
 * variables with different defaults, one of which was OFF. When they disagree,
 * the credential is stored correctly, listed correctly, reported healthy by
 * provider admission, and resolves for no project at all.
 *
 * Three states, and each needs different words:
 *
 *  - the gateway did not answer, or is too old to report the field → say
 *    nothing. An unreachable gateway is already reported on the Status tab, and
 *    inventing a scope warning from a missing field would be a second alarm for
 *    one fault.
 *  - the scope is OFF (empty string) → nothing published here reaches anyone.
 *  - the scope names a DIFFERENT project → likewise, and the two numbers are
 *    what an operator needs in order to fix it.
 */
export function SharedScopeWarning({
  publicProjectID,
}: {
  readonly publicProjectID: number;
}): ReactNode {
  const status = useGatewayStatus();
  const gatewayScope = status.data?.gateway?.shared_project_id;

  // `undefined` is not "off". A gateway that did not answer, or one older than
  // the field, must not produce a warning about a mismatch nobody can see.
  if (status.data?.reachable !== true || gatewayScope === undefined) return null;
  if (publicProjectID <= 0) return null;
  if (gatewayScope === String(publicProjectID)) return null;

  return (
    <Alert severity="error" data-testid="llm-providers-scope-mismatch">
      {gatewayScope === ''
        ? t(
            'pages.admin.llmProviders.scopeOff',
            'The LLM gateway is not reading platform-shared credentials at all, so nothing published here reaches any project. Set ELITEA_AI_PROJECT_ID on the gateway to {{id}}.',
            { id: publicProjectID },
          )
        : t(
            'pages.admin.llmProviders.scopeMismatch',
            'The LLM gateway reads platform-shared credentials from project {{gateway}}, but this panel publishes into project {{here}}. Nothing published here will resolve until the two match.',
            { gateway: gatewayScope, here: publicProjectID },
          )}
    </Alert>
  );
}
