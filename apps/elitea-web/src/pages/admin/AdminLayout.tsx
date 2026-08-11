/**
 * The admin SPA's root layout — the nav beside the routed page (issue #225).
 *
 * The root route used to render a bare `<Outlet/>`. Every one of unit A14's ten
 * pages worked by URL and none of them was linked from anywhere, so an operator
 * who opened `/admin/app/` saw Users and had no way to reach the other nine.
 * This is the component that makes the route tree navigable.
 *
 * `<main>` is a real landmark wrapping the `<Outlet/>`, which the pages'
 * `DrawerPage` (`height: 100%`, its own scroller) fills — so the nav stays put
 * while the page scrolls, rather than scrolling away with it.
 */
import type { ReactNode } from 'react';

import { Outlet } from '@tanstack/react-router';

import Box from '@mui/material/Box';

import { AdminNav } from './AdminNav';

export function AdminLayout(): ReactNode {
  return (
    <Box sx={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden' }}>
      <AdminNav />
      <Box component="main" sx={{ flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>
        <Outlet />
      </Box>
    </Box>
  );
}
