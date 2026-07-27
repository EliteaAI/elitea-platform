/** ROUTE-024 `/credentials/create-credential/:credentialType` — empty child of `create-credential.tsx` (same component, param-only refinement). */
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_shell/credentials/create-credential/$credentialType')({});
