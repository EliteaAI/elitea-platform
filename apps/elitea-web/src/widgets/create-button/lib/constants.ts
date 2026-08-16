/**
 * The 13-entity create-button catalogue (spec SHELL-013..026; old app:
 * `[fsd]/widgets/sidebar-root/lib/constants/createEntity.constant.js`).
 * Ported 1:1 for the fields this widget's reduced scope actually drives
 * (dropdown label, permission gate, destination route, breadcrumb-free
 * search params) — the old file's `BreadCrumbMap`/`PrevUrlPathMap`/
 * `RouteToLabelMap` fed a `location.state.routeStack` breadcrumb trail
 * consumed by page-level breadcrumb components that don't exist yet in any
 * landed Wave-2 unit (that's page-layer, not this widget's). Dropped rather
 * than faked; see this widget's README note in `index.ts`.
 */
import { t } from '@/shared/i18n';
import { PERMISSIONS } from '@/shared/lib/permissions';

import { CREATE_ROUTES } from './routes';

/** The 13 SHELL-013..025 entity kinds, in sidebar-dropdown order. */
export type CreateEntityKind =
  | 'chat'
  | 'agent'
  | 'skill'
  | 'pipeline'
  | 'credential'
  | 'toolkit'
  | 'application'
  | 'mcp'
  | 'bucket'
  | 'configuration'
  | 'token'
  | 'secret'
  | 'user';

export interface CreateEntityOption {
  readonly kind: CreateEntityKind;
  readonly label: string;
}

/** SHELL-013..025, in the old app's `DropdownItems` order. */
export function createEntityOptions(): readonly CreateEntityOption[] {
  return [
    { kind: 'chat', label: t('widgets.createButton.option.chat', 'Chat') },
    { kind: 'agent', label: t('widgets.createButton.option.agent', 'Agent') },
    { kind: 'skill', label: t('widgets.createButton.option.skill', 'Skill') },
    { kind: 'pipeline', label: t('widgets.createButton.option.pipeline', 'Pipeline') },
    { kind: 'credential', label: t('widgets.createButton.option.credential', 'Credential') },
    { kind: 'toolkit', label: t('widgets.createButton.option.toolkit', 'Toolkit') },
    { kind: 'application', label: t('widgets.createButton.option.application', 'Application') },
    { kind: 'mcp', label: t('widgets.createButton.option.mcp', 'MCP') },
    { kind: 'bucket', label: t('widgets.createButton.option.bucket', 'Artifact Bucket') },
    { kind: 'configuration', label: t('widgets.createButton.option.configuration', 'Configuration') },
    { kind: 'token', label: t('widgets.createButton.option.token', 'Token') },
    { kind: 'secret', label: t('widgets.createButton.option.secret', 'Secret') },
    { kind: 'user', label: t('widgets.createButton.option.user', 'Invite User') },
  ];
}

/**
 * `CreationPermissions` (old app). `undefined` = no gate (always enabled).
 * `credential`/`configuration`(model)/token/user permission strings the old
 * app used come from `PERMISSIONS` (S3, already ported) where a match
 * exists; the old app's bare `PERMISSIONS.users.create` maps to `user`.
 */
export const CREATE_ENTITY_PERMISSIONS: Readonly<Record<CreateEntityKind, readonly string[] | undefined>> = {
  chat: [PERMISSIONS.chat.folders.create, PERMISSIONS.chat.create],
  agent: [PERMISSIONS.applications.create],
  skill: [PERMISSIONS.applications.create],
  pipeline: [PERMISSIONS.applications.create],
  toolkit: [PERMISSIONS.toolkits.create],
  application: [PERMISSIONS.toolkits.create],
  mcp: [PERMISSIONS.toolkits.create],
  credential: undefined,
  bucket: [PERMISSIONS.artifacts.buckets.create, PERMISSIONS.artifacts.create],
  configuration: [PERMISSIONS.configuration.update],
  token: undefined,
  // `.create`, not `.list` (#402). This entry routes to
  // `/settings/secrets?createSecret=1`, which opens a new-secret row and ends
  // in a POST that `configuration.secrets.secret.create` gates. Gating the
  // entry on the LIST was harmless while the two strings had the same holders.
  // #402 gives the list to the viewer, so the two sets are now different, and
  // the list would offer a viewer a create flow that can only end in a 403.
  secret: [PERMISSIONS.secrets.create],
  user: [PERMISSIONS.users.create],
};

/** Routes that never need entity-type disambiguation — the button is a plain "create X" trigger (SHELL-026). */
export const SIMPLE_CREATE_ROUTE_SEGMENTS: readonly string[] = [
  'settings/analytics',
  'settings/prompts',
  'settings/environment',
  'settings/personalization',
  'settings/notifications',
  CREATE_ROUTES.onboarding,
  CREATE_ROUTES.agentsHub,
  CREATE_ROUTES.helpCenter,
];

/** Path segment fragments `currentEntityFromPathname` (lib/command.ts) matches against, in check order. */
export const ROUTE_TO_ENTITY_KIND: ReadonlyArray<{ segment: string; kind: CreateEntityKind }> = [
  { segment: CREATE_ROUTES.settingsModelConfiguration, kind: 'configuration' },
  { segment: CREATE_ROUTES.settingsTokens, kind: 'token' },
  { segment: CREATE_ROUTES.settingsSecrets, kind: 'secret' },
  { segment: CREATE_ROUTES.settingsUsers, kind: 'user' },
  { segment: CREATE_ROUTES.appsApplications, kind: 'application' },
  { segment: CREATE_ROUTES.appsCatalog, kind: 'application' },
  { segment: CREATE_ROUTES.chat, kind: 'chat' },
  { segment: CREATE_ROUTES.agents, kind: 'agent' },
  { segment: CREATE_ROUTES.skills, kind: 'skill' },
  { segment: CREATE_ROUTES.pipelines, kind: 'pipeline' },
  { segment: CREATE_ROUTES.credentials, kind: 'credential' },
  { segment: CREATE_ROUTES.toolkits, kind: 'toolkit' },
  { segment: CREATE_ROUTES.mcps, kind: 'mcp' },
  { segment: CREATE_ROUTES.artifacts, kind: 'bucket' },
];
