/**
 * ROUTE-049 `/artifacts/create-bucket` -> `CreateBucket` (spec §8.1).
 *
 * `?bucket=<name>` puts the same screen in EDIT mode. That is how the
 * baseline reaches bucket editing too: `routes.js:76` declares an
 * `EditBucket: '/artifacts/edit-bucket'` path that has zero call sites and
 * is never mounted, and the real flow (`Buckets.jsx:118-130`) pushes an
 * "Edit Bucket" breadcrumb and navigates to the CREATE-bucket path with the
 * bucket carried alongside (there, in redux; here, in the URL, which is
 * this app's own state channel and survives a reload). The phantom route is
 * deliberately NOT added.
 */
import { createFileRoute } from '@tanstack/react-router';

import { CreateBucket } from '@/pages/artifacts/CreateBucket';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { pickParams } from '../../-search/params';

export const Route = createFileRoute('/_shell/artifacts/create-bucket')({
  validateSearch: pickParams('bucket'),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: CreateBucket,
});
