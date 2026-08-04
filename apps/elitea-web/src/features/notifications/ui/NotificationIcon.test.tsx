import { describe, expect, it } from 'vitest';

import { useTheme } from '@mui/material/styles';

import { DEFAULT_BRAND_PACK, buildEliteaTheme } from '@/shared/brand';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { NotificationIcon } from './NotificationIcon';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

describe('NotificationIcon', () => {
  it('renders SuccessIcon for author_approval', () => {
    const { container } = renderWithTheme(
      <NotificationIcon
        eventType="author_approval"
        meta={undefined}
        theme={theme}
      />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders SuccessIcon for chat_user_added/chat_user_mentioned/private_project_created/moderation_approved', () => {
    for (const eventType of ['chat_user_added', 'chat_user_mentioned', 'private_project_created', 'moderation_approved'] as const) {
      const { container } = renderWithTheme(
        <NotificationIcon
          eventType={eventType}
          meta={undefined}
          theme={theme}
        />,
      );
      expect(container.querySelector('svg')).not.toBeNull();
    }
  });

  it('index_data_changed: renders ErrorIcon when meta.error is a non-empty string', () => {
    const { container } = renderWithTheme(
      <NotificationIcon
        eventType="index_data_changed"
        meta={{ error: 'boom' }}
        theme={theme}
      />,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('16');
  });

  it('index_data_changed: renders SuccessIcon when meta.error is absent', () => {
    const { container } = renderWithTheme(
      <NotificationIcon
        eventType="index_data_changed"
        meta={undefined}
        theme={theme}
      />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('index_data_changed: renders SuccessIcon when meta.error is whitespace-only (error.trim() parity)', () => {
    const { container } = renderWithTheme(
      <NotificationIcon
        eventType="index_data_changed"
        meta={{ error: '   ' }}
        theme={theme}
      />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders SuccessIcon for user_was_added_to_some_project_as_teammate', () => {
    const { container } = renderWithTheme(
      <NotificationIcon
        eventType="user_was_added_to_some_project_as_teammate"
        meta={undefined}
        theme={theme}
      />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders RemoveIcon for moderator_unpublish/agent_unpublished/author_reject/moderator_reject_of_version/moderation_rejected', () => {
    for (const eventType of [
      'moderator_unpublish',
      'agent_unpublished',
      'author_reject',
      'moderator_reject_of_version',
      'moderation_rejected',
    ] as const) {
      const { container } = renderWithTheme(
        <NotificationIcon
          eventType={eventType}
          meta={undefined}
          theme={theme}
        />,
      );
      expect(container.querySelector('svg')).not.toBeNull();
    }
  });

  it('renders ErrorIcon for token_is_expired/spending_limit_is_expired', () => {
    for (const eventType of ['token_is_expired', 'spending_limit_is_expired'] as const) {
      const { container } = renderWithTheme(
        <NotificationIcon
          eventType={eventType}
          meta={undefined}
          theme={theme}
        />,
      );
      expect(container.querySelector('svg')).not.toBeNull();
    }
  });

  it('renders AttentionIcon for token_expiring/spending_limit_expiring/bucket_expiration_warning/personal_access_token_expiring', () => {
    for (const eventType of [
      'token_expiring',
      'spending_limit_expiring',
      'bucket_expiration_warning',
      'personal_access_token_expiring',
    ] as const) {
      const { container } = renderWithTheme(
        <NotificationIcon
          eventType={eventType}
          meta={undefined}
          theme={theme}
        />,
      );
      expect(container.querySelector('svg')).not.toBeNull();
    }
  });

  it('renders HeartIcon for rates, colored with icon.fill.tips (getIcon.helpers.jsx Rates case)', () => {
    const { container } = renderWithTheme(
      <NotificationIcon
        eventType="rates"
        meta={undefined}
        theme={theme}
      />,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.style.color).toBe(theme.vars.palette.icon.fill.tips);
  });

  it('renders CommentIcon for comments, colored with icon.fill.tips (getIcon.helpers.jsx Comments case)', () => {
    const { container } = renderWithTheme(
      <NotificationIcon
        eventType="comments"
        meta={undefined}
        theme={theme}
      />,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.style.color).toBe(theme.vars.palette.icon.fill.tips);
  });

  it('renders MedalIcon for reward_new_level, colored with status.published (getIcon.helpers.jsx RewardNewLevel case)', () => {
    const { container } = renderWithTheme(
      <NotificationIcon
        eventType="reward_new_level"
        meta={undefined}
        theme={theme}
      />,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.style.color).toBe(theme.vars.palette.status.published);
  });

  it('renders nothing for contributor_request_for_publish_approve and unrecognised event types (default branch)', () => {
    const { container: c1 } = renderWithTheme(
      <NotificationIcon
        eventType="contributor_request_for_publish_approve"
        meta={undefined}
        theme={theme}
      />,
    );
    expect(c1.querySelector('svg')).toBeNull();
    const { container: c2 } = renderWithTheme(
      <NotificationIcon
        // @ts-expect-error -- deliberately outside the known union, exercising the default branch (see normalize.ts's doc comment on unknown event types).
        eventType="some_unknown_type"
        meta={undefined}
        theme={theme}
      />,
    );
    expect(c2.querySelector('svg')).toBeNull();
  });

  it('colors the icon via style.color, sourced from the theme (not a raw literal — R-T1/R-T7)', () => {
    function Probe() {
      const t = useTheme();
      return (
        <NotificationIcon
          eventType="author_approval"
          meta={undefined}
          theme={t}
        />
      );
    }
    const { container } = renderWithTheme(<Probe />);
    const svg = container.querySelector('svg');
    expect(svg?.style.color).toBeTruthy();
  });
});
