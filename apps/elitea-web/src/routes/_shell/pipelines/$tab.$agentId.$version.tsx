/** ROUTE-069 `/pipelines/:tab/:agentId/:version` — empty child, see agents' `$version` file header for the pattern. */
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_shell/pipelines/$tab/$agentId/$version')({});
