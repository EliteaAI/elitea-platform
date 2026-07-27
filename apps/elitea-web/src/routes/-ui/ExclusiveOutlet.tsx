/**
 * Reproduces the OLD app's mutually-exclusive list-vs-detail rendering
 * (`ProtectedRoutes.jsx`'s flat `<Route>` array: `/agents/:tab` [Applications
 * list] and `/agents/:tab/:agentId` [EditApplication detail] are SIBLING
 * routes, never nested/rendered together) inside TanStack Router's
 * file-based tree, where a shared path prefix (`/agents/$tab` and
 * `/agents/$tab/$agentId`) makes the shorter route the structural PARENT of
 * the longer one (verified against the installed
 * `@tanstack/router-generator@1.168.23`: `RoutePrefixMap.findParent` nests
 * by longest-matching registered path, unconditionally).
 *
 * Used by every "$tab list page that also has a $entityId detail child"
 * route (agents, skills, pipelines, credentials, toolkits, mcps, apps):
 * renders the list page's own content only when nothing deeper matched;
 * renders just `<Outlet/>` when a child route (the detail page) is active,
 * so the two screens stay exclusive instead of visually nesting.
 *
 * Routes whose child is a param-only refinement of the SAME screen (the
 * `:version` sub-routes, `create-configuration/:credentialType`, etc.) do
 * NOT use this — they render their own content unconditionally plus a
 * trailing `<Outlet/>`, since old app's child element there is empty
 * (`<Route path=":version" element={<></>} />`) and the parent is meant to
 * keep showing regardless.
 */
import { Outlet, useChildMatches } from '@tanstack/react-router';
import type { ReactNode } from 'react';

export function ExclusiveOutlet({ children }: { children: ReactNode }) {
  const childMatches = useChildMatches();
  if (childMatches.length > 0) {
    return <Outlet />;
  }
  return (
    <>
      {children}
      <Outlet />
    </>
  );
}
