/** ROUTE-073 `/user-public/pipelines/:agentId/:version` (spec id ROUTE-069c) — empty child. */
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_shell/user-public/pipelines/$agentId/$version')({});
