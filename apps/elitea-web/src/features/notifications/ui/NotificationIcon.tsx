/**
 * features/notifications/ui/NotificationIcon.tsx — port of
 * `apps/elitea-ui/src/[fsd]/entities/notifications/lib/helpers/
 * getIcon.helpers.jsx` (unit A11).
 *
 * `getIcon.helpers.jsx`'s `switch` also has cases for `NotificationType`
 * members that do NOT exist in the current enum (`PromptModeratorApproval`,
 * `PromptOfSomeProjectWasPublished`, `NewPromptVersionOfSomeProjectWas
 * Published/Created`, `PromptHasAddedToSomeProject`, `PromptModeratorReject`,
 * `PromptOfSomeProjectWasRejected`, `NewPromptVersionOfSomeProjectWas
 * Rejected`, `RewardBadgeToPrompt`) — `entities/notification`'s own doc
 * comment (unit E1) already flags these as dead code and excludes them from
 * `NotificationEventType`; this port does the same (a case for a value
 * outside the type union would not compile). The dead
 * `RewardBadgeToPrompt` -> `TrophyOutlinedIcon` branch is why
 * `TrophyOutlinedIcon` is not needed below despite being in the baseline
 * switch.
 *
 * **Blocked, documented (not silently dropped):** three of the baseline's
 * icons — `CommentIcon` (`Comments`), `HeartIcon` (`Rates`), `MedalIcon`
 * (`RewardNewLevel`) — were NOT ported to `shared/ui/icons/**` by unit S2
 * (verified: `find src/shared/ui/icons -iname '*comment*' -o -iname
 * '*heart*' -o -iname '*medal*'` -> no match, while their old-app sources
 * DO exist: `apps/elitea-ui/src/components/Icons/{CommentIcon,HeartIcon,
 * MedalIcon}.jsx`). Per this unit's ownership fence (`src/features/
 * notifications/` only — `shared/ui/icons/**` belongs to S2), these three
 * cases render `null` rather than importing a nonexistent module or adding
 * an icon file outside this unit's owned path. `attention-icon.tsx`,
 * `error-icon.tsx`, `remove-icon.tsx`, `success-icon.tsx`, `mark-read-icon.tsx`,
 * `mark-unread-icon.tsx` all exist and are used below/by `NotificationListItem`.
 */
import type { ReactElement } from 'react';

import type { Theme } from '@mui/material/styles';

import { AttentionIcon } from '@/shared/ui/icons/attention-icon';
import { ErrorIcon } from '@/shared/ui/icons/error-icon';
import { RemoveIcon } from '@/shared/ui/icons/remove-icon';
import { SuccessIcon } from '@/shared/ui/icons/success-icon';

import type { NotificationEventType } from '@/entities/notification';

import type { FullNotificationMeta } from '../api/normalize';

export interface NotificationIconProps {
  readonly eventType: NotificationEventType;
  readonly meta: FullNotificationMeta | undefined;
  readonly theme: Theme;
}

const ICON_SIZE = 16;

type Palette = Theme['vars']['palette'];
type IconRenderer = (palette: Palette, meta: FullNotificationMeta | undefined) => ReactElement | null;

function successPublished(palette: Palette): ReactElement | null {
  return <SuccessIcon style={{ color: palette.status.published }} />;
}

function successTips(palette: Palette): ReactElement | null {
  return <SuccessIcon style={{ color: palette.icon.fill.tips }} />;
}

function removeRejected(palette: Palette): ReactElement | null {
  return <RemoveIcon style={{ color: palette.status.rejected }} />;
}

function errorRejected(palette: Palette): ReactElement | null {
  return (
    <ErrorIcon
      width={ICON_SIZE}
      height={ICON_SIZE}
      style={{ color: palette.status.rejected }}
    />
  );
}

function attentionOnModeration(palette: Palette): ReactElement | null {
  return (
    <AttentionIcon
      width={ICON_SIZE}
      height={ICON_SIZE}
      style={{ color: palette.status.onModeration }}
    />
  );
}

/**
 * `index_data_changed` alone branches on `meta` (`getIcon.helpers.jsx:24-32`:
 * a failed reindex reports the same as a hard error).
 */
function indexDataChangedIcon(palette: Palette, meta: FullNotificationMeta | undefined): ReactElement | null {
  const error = meta?.error;
  const hasError = typeof error === 'string' && error.trim() !== '';
  return hasError ? errorRejected(palette) : successPublished(palette);
}

/**
 * 'rates' (HeartIcon), 'comments' (CommentIcon), 'reward_new_level'
 * (MedalIcon): icon missing from `shared/ui/icons/**` — see module doc
 * comment. No icon is rendered; the notification text itself is
 * unaffected (`NotificationListItem`'s `showIcon` slot degrades to an
 * empty icon-container box, not a layout break).
 */
function noIcon(): null {
  return null;
}

/**
 * One entry per {@link NotificationEventType} member — see `../lib/
 * routes.ts`'s `HREF_RESOLVERS` doc comment for why a `Record` literal over
 * the full union (rather than a `switch`) is this file's exhaustiveness
 * mechanism. `contributor_request_for_publish_approve` has no baseline
 * `getIcon.helpers.jsx` case at all — {@link noIcon}, same as the baseline's
 * implicit `default: return null`.
 */
const ICON_RENDERERS: Record<NotificationEventType, IconRenderer> = {
  author_approval: successPublished,
  moderator_approval_of_version: successPublished,
  chat_user_added: successPublished,
  chat_user_mentioned: successPublished,
  private_project_created: successPublished,
  moderation_approved: successPublished,
  index_data_changed: indexDataChangedIcon,
  user_was_added_to_some_project_as_teammate: successTips,
  moderator_unpublish: removeRejected,
  agent_unpublished: removeRejected,
  author_reject: removeRejected,
  moderator_reject_of_version: removeRejected,
  moderation_rejected: removeRejected,
  token_is_expired: errorRejected,
  spending_limit_is_expired: errorRejected,
  token_expiring: attentionOnModeration,
  spending_limit_expiring: attentionOnModeration,
  bucket_expiration_warning: attentionOnModeration,
  personal_access_token_expiring: attentionOnModeration,
  rates: noIcon,
  comments: noIcon,
  reward_new_level: noIcon,
  contributor_request_for_publish_approve: noIcon,
};

/**
 * Port of `getIcon.helpers.jsx:11-104`'s `getIcon(type, theme, notification)`.
 * `theme` is passed explicitly (not read via `useTheme()` inside this
 * component) so it stays a plain render function usable from both
 * `NotificationListItem` (which already holds a `theme` from its own
 * `useTheme()` call, R-T4) and any future consumer without a second theme
 * subscription. Falls back to {@link noIcon} for an `eventType` outside the
 * known union (`../api/normalize.ts` preserves an unrecognised wire
 * `event_type` verbatim), same reasoning as `../lib/routes.ts`'s resolver.
 */
export function NotificationIcon(props: NotificationIconProps): ReactElement | null {
  const { eventType, meta, theme } = props;
  const render = ICON_RENDERERS[eventType] ?? noIcon;
  return render(theme.vars.palette, meta);
}
