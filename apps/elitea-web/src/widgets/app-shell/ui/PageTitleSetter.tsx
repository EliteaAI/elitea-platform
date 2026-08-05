import { useEffect } from 'react';

import { useRouterState } from '@tanstack/react-router';

import { derivePageTitle } from '../lib/pageTitle';

export interface PageTitleSetterProps {
  projectName: string | undefined;
}

/** Ported from `hooks/useBrowserPageTitle.js`'s `PageTitleSetter` (reduced-scope notes: `../lib/pageTitle.ts`). Renders nothing. */
export function PageTitleSetter({ projectName }: PageTitleSetterProps): null {
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });
  const searchName = useRouterState({
    select: (routerState) => {
      const search = routerState.location.search as Record<string, unknown> | undefined;
      const value = search?.['name'];
      return typeof value === 'string' ? value : '';
    },
  });

  useEffect(() => {
    document.title = derivePageTitle(pathname, searchName, projectName);
  }, [pathname, searchName, projectName]);

  return null;
}
