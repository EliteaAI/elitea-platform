/** ROUTE-068 `/skills/:tab/:skillId/:version` — empty child, see agents' `$version` file header for the pattern. */
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_shell/skills/$tab/$skillId/$version')({});
