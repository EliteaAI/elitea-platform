/**
 * ROUTE-058 `/settings/secrets` -> `Secrets` page.
 *
 * Two Phase-2 fixes here:
 *
 * 1. The `RouteShell` heading is gone. `SecretsContent` renders its own
 *    `DrawerPageHeader` with the same "Secrets" title (`Secrets.tsx:298`),
 *    so the shell was emitting a duplicate `<h1>` above the real one.
 * 2. `search`/`onSearchChange` were hard-wired to `""` and `() => {}`, which
 *    rendered a real search input that could never filter anything. The
 *    route owns that state now.
 *
 * Deliberately `useState`, NOT a URL param: `search` is not in
 * `-search/params.ts`, and the parity manifest declares exactly one query
 * param for this route family (PARAM-060 `createSecret`). Adding a
 * `?search=` param would invent URL surface the baseline does not have.
 * The filter itself is client-side over already-fetched rows
 * (`Secrets.tsx:197-202`), so component state is also the faithful shape.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { SecretsContent } from '@/pages/settings/Secrets';
import { pickParams } from '@/routes/-search/params';
import { RouteError, RoutePending } from '@/routes/-ui/RouteStatus';

export const Route = createFileRoute('/_shell/settings/secrets')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  validateSearch: pickParams('createSecret'),
  component: SecretsPage,
});

function SecretsPage() {
  const { createSecret } = Route.useSearch();
  const [search, setSearch] = useState('');

  return (
    <SecretsContent
      shouldCreate={createSecret === '1'}
      search={search}
      onSearchChange={setSearch}
    />
  );
}
