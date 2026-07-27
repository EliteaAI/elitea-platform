/** ROUTE-038 `/apps/create/:appType` — empty child of `create.tsx`. */
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_shell/apps/create/$appType')({});
