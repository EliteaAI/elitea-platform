/** ROUTE-033 `/mcps/create/:mcpType` — empty child of `create.tsx`. */
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_shell/mcps/create/$mcpType')({});
