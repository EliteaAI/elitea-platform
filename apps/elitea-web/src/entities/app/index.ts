/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
export type {
  App,
  AppDetail,
  AppDetailWire,
  AppPage,
  AppPageWire,
  AppVersionDetail,
  AppVersionDetailWire,
  AppWire,
} from './model/types';
export { calculateNewLikesCount, filterAppsByQuery } from './model/selectors';
export {
  normaliseApp,
  normaliseAppDetail,
  normaliseAppPage,
  normaliseApps,
  normaliseAppVersionDetail,
} from './lib/normalise';
