/**
 * Route-path string catalogue for the 13-entity create button (spec SHELL-013
 * .. SHELL-026; old app: `apps/elitea-ui/src/[fsd]/widgets/sidebar-root/lib/
 * constants/createEntity.constant.js`'s `RouteDefinitions.*` references).
 *
 * `widgets/create-button` cannot import `src/routes/**` (that tree is not a
 * `src/<layer>/` directory dependency-cruiser's R-L1 rules recognise, but
 * conceptually it sits at/above `pages` — importing it from a widget would
 * invert the intended composition direction: pages/routes are supposed to
 * mount widgets, not the reverse). These are therefore plain string literal
 * duplicates of the real paths R1 built under `src/routes/_shell/**`, the
 * same "flat path-constant catalogue" shape the old app's own
 * `RouteDefinitions` used. TypeScript still catches drift: `router.tsx`'s
 * `declare module '@tanstack/react-router' { interface Register … } }`
 * ambient augmentation makes every `useNavigate()`/`<Link>` call in the
 * whole program (this file's consumers included) type-check `to` against
 * the REAL registered route tree, so a typo or a route that R1 renames
 * fails `tsc --noEmit` here even though this file imports nothing from
 * `src/routes/`.
 *
 * Verified against the actual route files (not guessed): every path below
 * was read directly from its `createFileRoute('/_shell/...')` call.
 */
export const CREATE_ROUTES = {
  chat: '/chat',
  agents: '/agents',
  agentsCreate: '/agents/create',
  pipelines: '/pipelines',
  pipelinesCreate: '/pipelines/create',
  skills: '/skills',
  skillsCreate: '/skills/create',
  toolkits: '/toolkits',
  toolkitsCreate: '/toolkits/create',
  mcps: '/mcps',
  mcpsCreate: '/mcps/create',
  credentials: '/credentials',
  credentialsCreate: '/credentials/create-credential',
  apps: '/apps',
  appsApplications: '/apps/applications',
  appsCatalog: '/apps/catalog',
  artifacts: '/artifacts',
  artifactsCreateBucket: '/artifacts/create-bucket',
  settingsSecrets: '/settings/secrets',
  settingsUsers: '/settings/users',
  settingsTokens: '/settings/tokens',
  settingsModelConfiguration: '/settings/model-configuration',
  settingsCreateConfiguration: '/settings/create-configuration',
  settingsCreatePersonalToken: '/settings/create-personal-token',
  settingsPrompts: '/settings/prompts',
  settingsEnvironment: '/settings/environment',
  settingsPersonalization: '/settings/personalization',
  settingsNotifications: '/settings/notifications',
  settingsAnalytics: '/settings/analytics',
  onboarding: '/onboarding',
  agentsHub: '/agents-hub',
  helpCenter: '/help-center',
} as const;

export type CreateRouteKey = keyof typeof CREATE_ROUTES;
