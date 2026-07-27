/** ROUTE-028 `/toolkits/create/:toolkitType` — empty child of `create.tsx`. */
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_shell/toolkits/create/$toolkitType')({});
