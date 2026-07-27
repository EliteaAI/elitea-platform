/**
 * features/notifications/ui/LegacyNotificationMessage.tsx — port of
 * `apps/elitea-ui/src/[fsd]/entities/notifications/ui/
 * LegacyNotificationMessage.jsx` (unit A11).
 *
 * "Legacy fallback renderer for notifications that pre-date meta.message
 * storage. Remove once all environments have run the backfill migration."
 * — the source file's own header. Renders only when
 * `NotificationMessage`'s `message` is absent.
 *
 * **Deliberate, disclosed simplification of the link-navigation layer**
 * (documented precisely, not silently dropped): the baseline splits link
 * navigation across TWO hooks, `useNotificationNavigate` (current-tab,
 * carries a `routeStack` breadcrumb through `react-router-dom`'s
 * imperative `navigate(..., {state})`) and `useNotificationNewTabNavigate`
 * (new-tab, builds a plain absolute href). Tracing every `parseInformation`
 * branch that can actually reach a `MyCurrentTabLink` (i.e. `firstLinkInfo`
 * without `isNewTab: true`) against `useNotificationNavigate`'s own
 * `urlMap` (`ChatUserAdded`/`PersonalAccessTokenExpiring`/`IndexDataChanged`
 * only) shows **zero overlap**: every reachable current-tab case
 * (`token_expiring`/`spending_limit_expiring`/`rates`/`comments`/etc., the
 * `linkText: 'Configuration'`/`'settings section'`/prompt-name cases) hits
 * `urlMap[event_type] === undefined`, so the baseline's own `navigate({
 * pathname: undefined, search: undefined })` is a no-op in every REACHABLE
 * case — a pre-existing dead/broken code path, not a live behaviour this
 * port needs to reproduce. Every case that DOES have a resolvable
 * `useNotificationNewTabNavigate` entry (`chat_user_added` via
 * `ChatUserAdded`, `index_data_changed`, `bucket_expiration_warning`,
 * `personal_access_token_expiring`) always sets `isNewTab: true` in
 * `parseInformation` — confirmed field-by-field against
 * `notificationLegacy.helpers.js:169-230`. `useNotificationNewTabNavigate`'s
 * own url/search construction is byte-identical to `notification.helpers.js`'s
 * `resolveHref` for these same 4 event types (both read the same meta
 * fields into the same path/query shape) — so `../lib/routes.ts`'s
 * `resolveNotificationHref` (the `resolveHref` port) is reused here as the
 * SINGLE href source for both the markdown-message renderer
 * (`NotificationMessage.tsx`) and this legacy one, rather than
 * re-implementing a second, provably-redundant hook pair. Net effect:
 * new-tab links render with the exact same href the baseline produces;
 * current-tab links render as plain (non-interactive) text instead of a
 * clickable-but-inert control — same observable "does nothing useful when
 * activated" outcome, without deliberately shipping a focusable dead
 * control (R-C1). The `routeStack` breadcrumb-state mechanism itself
 * (`useNotificationNavigate`'s `state: {routeStack}}`, used only to label a
 * future back-navigation) has no equivalent anywhere in Wave 0/1's output
 * and is dropped — flagged in this unit's final report, not silently lost.
 */
import type { ReactElement } from 'react';

import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import type { TypographyProps } from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import type { NotificationEventType } from '@/entities/notification';

import type { FullNotificationMeta } from '../api/normalize';
import type { LegacyLinkInfo } from '../lib/legacyText';
import { endingText, formatName, leadingText, middleText, parseLegacyInformation } from '../lib/legacyText';
import { buildAgentVersionHref, notificationBaseUrl, resolveNotificationHref } from '../lib/routes';

export interface LegacyNotificationMessageProps {
  readonly eventType: NotificationEventType;
  readonly meta: FullNotificationMeta | undefined;
  readonly projectId: string | undefined;
  readonly onCloseNotificationList?: (() => void) | undefined;
  readonly textVariant: TypographyProps['variant'];
  readonly textColor: string;
}

interface LegacyLinkProps {
  readonly linkInfo: LegacyLinkInfo;
  readonly eventType: NotificationEventType;
  readonly meta: FullNotificationMeta | undefined;
  readonly projectId: string | undefined;
  readonly needTrim: boolean;
  readonly onCloseNotificationList?: (() => void) | undefined;
}

/**
 * See the module doc comment: new-tab links get a real href (via the same
 * resolver `NotificationMessage.tsx` uses); current-tab links have no
 * resolvable baseline destination and render as plain text.
 */
function LegacyLink(props: LegacyLinkProps): ReactElement {
  const { linkInfo, eventType, meta, projectId, needTrim, onCloseNotificationList } = props;
  const label = needTrim ? formatName(linkInfo.linkText) : linkInfo.linkText;

  if (linkInfo.isNewTab !== true) {
    return <span>{label}</span>;
  }

  const href = resolveNotificationHref(eventType, meta, projectId);
  if (href === null) {
    return <span>{label}</span>;
  }

  return (
    <Link
      variant="labelMedium"
      sx={{ textDecoration: 'underline', cursor: 'pointer' }}
      target="_blank"
      rel="noopener noreferrer"
      href={href}
      onClick={onCloseNotificationList}
    >
      {label}
    </Link>
  );
}

interface AgentUnpublishedMessageProps {
  readonly textVariant: TypographyProps['variant'];
  readonly agentUnpublishedMeta: NonNullable<ReturnType<typeof parseLegacyInformation>['agentUnpublishedMeta']>;
}

/**
 * `LegacyNotificationMessage.jsx:96-99` parity: this href ALWAYS uses the
 * notification's own project_id (`agentUnpublishedMeta.projectId`), unlike
 * `resolveNotificationHref`'s general `agent_unpublished` case which prefers
 * `meta.project_id` — see `buildAgentVersionHref`'s doc comment. Split out
 * of the main component to keep both under the §3.5 complexity budget.
 */
function AgentUnpublishedMessage(props: AgentUnpublishedMessageProps): ReactElement {
  const { textVariant, agentUnpublishedMeta } = props;
  const { sourceVersionId, sourceApplicationId, projectId: agentProjectId, reasonSuffix } = agentUnpublishedMeta;
  const href =
    sourceApplicationId !== undefined && sourceVersionId !== undefined
      ? buildAgentVersionHref(notificationBaseUrl(), agentProjectId, sourceApplicationId, sourceVersionId)
      : null;
  return (
    <Typography
      variant={textVariant}
      color="text.secondary"
    >
      {t('notifications.legacy.agentUnpublished.leading', 'Unpublished agent version id: ')}
      {href === null ? (
        sourceVersionId
      ) : (
        <Link
          variant={textVariant}
          color="text.secondary"
          sx={{ textDecoration: 'underline', cursor: 'pointer' }}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {sourceVersionId}
        </Link>
      )}
      {t('notifications.legacy.agentUnpublished.trailing', ' from project id: {{projectId}}.{{reasonSuffix}}', {
        projectId: agentProjectId ?? '',
        reasonSuffix,
      })}
    </Typography>
  );
}

interface StandardMessageProps {
  readonly eventType: NotificationEventType;
  readonly meta: FullNotificationMeta;
  readonly projectId: string | undefined;
  readonly onCloseNotificationList?: (() => void) | undefined;
  readonly textVariant: TypographyProps['variant'];
  readonly textColor: string;
  readonly info: ReturnType<typeof parseLegacyInformation>;
}

/** The `leadingText(...)[eventType]` + up-to-2-links + `endingText(...)[eventType]` composition — every non-`agent_unpublished` event type. */
function StandardLegacyMessage(props: StandardMessageProps): ReactElement {
  const { eventType, meta, projectId, onCloseNotificationList, textVariant, textColor, info } = props;
  const { leadingTextParam1 = '', leadingTextParam2 = '', firstLinkInfo, hasMiddleText, secondLinkInfo, endingTextParam = '' } = info;
  return (
    <Typography
      variant={textVariant}
      sx={{ color: textColor }}
    >
      {leadingText(leadingTextParam1, leadingTextParam2)[eventType]}
      {firstLinkInfo && (
        <LegacyLink
          linkInfo={firstLinkInfo}
          eventType={eventType}
          meta={meta}
          projectId={projectId}
          needTrim
          onCloseNotificationList={onCloseNotificationList}
        />
      )}
      {hasMiddleText === true && middleText[eventType]}
      {secondLinkInfo && (
        <LegacyLink
          linkInfo={secondLinkInfo}
          eventType={eventType}
          meta={meta}
          projectId={projectId}
          needTrim
          onCloseNotificationList={onCloseNotificationList}
        />
      )}
      {endingText(endingTextParam)[eventType]}
    </Typography>
  );
}

export function LegacyNotificationMessage(props: LegacyNotificationMessageProps): ReactElement | null {
  const { eventType, meta, projectId, onCloseNotificationList, textVariant, textColor } = props;
  // Deliberate safety addition beyond the baseline: `LegacyNotificationMessage.jsx`
  // destructures `meta.reason` etc. with NO undefined guard at all, so a
  // notification with no `meta` object would throw there. `entities/notification`'s
  // `Notification.meta` is genuinely optional (unit E1), and this port's §3.6
  // discipline ("errors are values, never throw for absent/malformed data") means
  // "nothing to render" is the correct degraded state, not a crash.
  if (meta === undefined) return null;

  const info = parseLegacyInformation(eventType, meta, projectId);

  if (eventType === 'agent_unpublished' && info.agentUnpublishedMeta !== undefined) {
    return (
      <AgentUnpublishedMessage
        textVariant={textVariant}
        agentUnpublishedMeta={info.agentUnpublishedMeta}
      />
    );
  }

  return (
    <StandardLegacyMessage
      eventType={eventType}
      meta={meta}
      projectId={projectId}
      onCloseNotificationList={onCloseNotificationList}
      textVariant={textVariant}
      textColor={textColor}
      info={info}
    />
  );
}
