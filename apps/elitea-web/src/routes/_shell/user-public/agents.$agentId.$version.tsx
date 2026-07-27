/** ROUTE-072 `/user-public/agents/:agentId/:version` (spec id ROUTE-069b) — empty child, see agents' `$version` file header for the pattern. */
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_shell/user-public/agents/$agentId/$version')({});
