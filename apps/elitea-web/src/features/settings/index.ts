/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 *
 * `src/features/settings/` backs the settings domain's page-level
 * compositions in `src/pages/settings/` (Wave-2 unit A9, relocated here
 * from `src/routes/_shell/settings/` — see that unit's report). One
 * OBJECT BUNDLE per subdomain (same pattern established by
 * `widgets/chat-box`'s `participantSources`/`voiceHooks`/
 * `agentEditorHooks`) keeps the ~26 symbols pages/settings/** actually
 * needs down to a handful of slots — each bundle costs exactly 1 slot
 * regardless of property count.
 */
import { useUsersActions } from './lib/users/useUsersActions';
import { UsersPageContent } from './ui/users/UsersPageContent';

import { ServicePromptsBody } from './ui/system-prompts/ServicePromptsBody';
export type { PromptConfig } from './ui/system-prompts/ServicePrompts.types';

import { SecretsTable } from './ui/secrets/SecretsTable';

import { DrawerPage } from './ui/drawer-page/DrawerPage';

import { ProjectContextBody, ProjectContextToasts } from './ui/project-context/ProjectContextBody';
import { projectContextStyles } from './ui/project-context/ProjectContext.styles';

import { useDefaultModel } from './lib/profile/useDefaultModel';
import { ProfileFormContent } from './ui/profile/ProfileFormContent';
import { ProfileValidationSchema, deserializeProfileFormData, serializeProfileFormData } from './lib/profile/profileUtils';
export type { ProfileFormValues } from './lib/profile/profileUtils';

import { ENVIRONMENT_FIELD_DEFAULTS, ENVIRONMENT_FIELD_ORDER, ENVIRONMENT_SECTION } from './lib/environment/environment.constants';
import { buildFieldDefinition, validateFieldValue } from './lib/environment/environmentField.helpers';
import { EnvironmentFieldRow } from './ui/environment/EnvironmentFieldRow';
export type { EnvironmentFieldDefinition } from './lib/environment/environmentField.helpers';

import ConfigurationsPanel from './ui/ai-configuration/ConfigurationsPanel';
import OpenAITemplate from './ui/ai-configuration/OpenAITemplate';
import { useConfigurationsBySection } from './lib/ai-configuration/useConfigurationsBySection';

/** Users tab (`pages/settings/Users.tsx`). */
export const usersFeature = { useUsersActions, UsersPageContent };

/** System-prompts tab (`pages/settings/ServicePrompts.tsx`). */
export const servicePromptsFeature = { ServicePromptsBody };

/** Secrets tab (`pages/settings/Secrets.tsx`). */
export const secretsFeature = { SecretsTable };

/** Shared full-height tab-content layout wrapper, ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/drawer-page/DrawerPage.jsx`. */
export const drawerPage = { DrawerPage };

/** Project-context tab (`pages/settings/ProjectContext.tsx`). */
export const projectContextFeature = { ProjectContextBody, ProjectContextToasts, projectContextStyles };

/** Personalization tab (`pages/settings/Personalization.tsx`). */
export const profileFeature = { useDefaultModel, ProfileFormContent, ProfileValidationSchema, deserializeProfileFormData, serializeProfileFormData };

/** Environment tab (`pages/settings/Environment.tsx`). */
export const environmentFeature = { ENVIRONMENT_FIELD_DEFAULTS, ENVIRONMENT_FIELD_ORDER, ENVIRONMENT_SECTION, buildFieldDefinition, validateFieldValue, EnvironmentFieldRow };

/** AI-configuration tab (`pages/settings/AIConfiguration.tsx`). */
export const aiConfigurationFeature = { ConfigurationsPanel, OpenAITemplate, useConfigurationsBySection };
