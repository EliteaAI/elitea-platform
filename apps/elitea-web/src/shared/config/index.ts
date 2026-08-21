/**
 * Public surface of the runtime-config module (spec §9.3 unit F3; §7.1
 * C5–C7b). The app layer calls getConfig() and renders MissingEnvPage on a
 * 'missing' result — nothing here runs at import time.
 *
 * resetConfigForTests (get-config.ts) and the backendCapabilities test
 * setters are deliberately NOT re-exported: they are test-isolation
 * machinery, not production surface.
 */
export { hasBackendCapability } from './backendCapabilities';
export type { BackendCapability } from './backendCapabilities';
export { getConfig } from './get-config';
export type { ConfigResult } from './get-config';
export type { Config, ConfigKey, RequiredConfigKey } from './schema';
export { MissingEnvPage } from './ui/MissingEnvPage';
