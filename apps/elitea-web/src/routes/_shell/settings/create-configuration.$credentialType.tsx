/** ROUTE-064 `/settings/create-configuration/:credentialType` — empty child of `create-configuration.tsx` (IntegrationGuard cascades from parent). */
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_shell/settings/create-configuration/$credentialType')({});
