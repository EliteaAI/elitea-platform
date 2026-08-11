/**
 * The admin route group (unit A14) — mounted by `src/entries/admin/main.tsx`.
 *
 * CODE-based TanStack Router, not file-based. `vite.config.ts` registers the
 * `tanstackRouter` plugin for the MAIN app target only ("admin and maintenance
 * are plain single-entry SPAs with no route tree"), so there is no
 * `routeTree.gen.ts` for this bundle to import and no `src/routes/**` scan.
 * `createRootRoute`/`createRoute` build the same router by hand, which is the
 * supported alternative and keeps the admin bundle's route set out of the main
 * app's generated tree.
 *
 * `basepath` is `/admin/app`, matching `vite.config.ts`'s `base` and the Go
 * adminui handler's `BasePath` — the handler serves this SPA at that prefix and
 * rewrites its asset URLs to match.
 *
 * Users, Audit Trail, Roles, Projects, Secrets, Schedules & Tasks, App
 * Requests and Configuration exist so far; issue #200 lists the remaining
 * two. The
 * index route RENDERS it rather than redirecting to `/users`: a `redirect()`
 * here would be type-checked against the MAIN app's generated route ids (the
 * `Register` interface `routeTree.gen.ts` declares is global), which this
 * hand-built tree is not part of. Rendering also spares the extra history entry.
 */
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  type AnyRouter,
} from '@tanstack/react-router';

import { AdminAppRequests } from './AppRequests';
import { AdminAuditTrail } from './AuditTrail';
import { AdminConfiguration } from './Configuration';
import { AdminProjects } from './Projects';
import { AdminRoles } from './Roles';
import { AdminSchedulesTasks } from './SchedulesTasks';
import { AdminSecrets } from './Secrets';
import { AdminServiceDescriptors } from './ServiceDescriptors';
import { AdminUsers } from './Users';

const ADMIN_BASE_PATH = '/admin/app';

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: AdminUsers,
});

const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/users',
  component: AdminUsers,
});

const auditTrailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/audit',
  component: AdminAuditTrail,
});

const rolesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/roles',
  component: AdminRoles,
});

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: AdminProjects,
});

const secretsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/secrets',
  component: AdminSecrets,
});

const configurationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/configuration',
  component: AdminConfiguration,
});

const schedulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/schedules',
  component: AdminSchedulesTasks,
});

const appRequestsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app-requests',
  component: AdminAppRequests,
});

/**
 * The path is `/service-descriptors`. The reference SPA has no route for this
 * page at all — `routes.js` never declares one and nothing imports
 * `ServiceDescriptorsPage`, so that file is dead code there; the surface an
 * operator reaches is the sibling section embedded in Configuration. This route
 * gives the page a home, and the Configuration section states the same
 * server-declared reason.
 */
const serviceDescriptorsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/service-descriptors',
  component: AdminServiceDescriptors,
});

const adminRouteTree = rootRoute.addChildren([
  indexRoute,
  usersRoute,
  auditTrailRoute,
  rolesRoute,
  projectsRoute,
  secretsRoute,
  schedulesRoute,
  appRequestsRoute,
  configurationRoute,
  serviceDescriptorsRoute,
]);

export function createAdminRouter(): AnyRouter {
  return createRouter({
    routeTree: adminRouteTree,
    basepath: ADMIN_BASE_PATH,
    defaultPreload: 'intent',
  });
}
