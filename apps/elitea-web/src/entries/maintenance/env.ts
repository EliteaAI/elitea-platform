/**
 * Environment variable helper for the maintenance entry point.
 *
 * The old Maintenance-UI used a shared `@/utils/env` module that checked
 * `globalThis.elitea_ui_config`, `import.meta.env`, `globalThis.__ENV__`, and
 * `process.env` in sequence. This is a minimal standalone version.
 */

/** 1. elitea_ui_config shim (used by the Go adminui handler for injection). */
function readFromUiConfigShim(key: string): string | undefined {
  const anyGlobal = globalThis as unknown as Record<string, unknown>;
  const cfg =
    typeof anyGlobal.elitea_ui_config === 'object' && anyGlobal.elitea_ui_config !== null
      ? (anyGlobal.elitea_ui_config as Record<string, string>)
      : undefined;
  return cfg && key.toLowerCase() in cfg ? cfg[key.toLowerCase()] : undefined;
}

/** 2. Vite's import.meta.env (build-time injected). */
function readFromImportMetaEnv(key: string): string | undefined {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && key in import.meta.env) {
      return (import.meta.env as Record<string, string>)[key];
    }
  } catch {
    // import.meta unavailable — continue to next fallback
  }
  return undefined;
}

/** 3. process.env (Node / Jest). */
function readFromProcessEnv(key: string): string | undefined {
  return typeof process !== 'undefined' && process.env && key in process.env
    ? process.env[key]
    : undefined;
}

/** Read an environment variable, checking multiple fallback sources in priority
 * order. Returns `undefined` when the variable is not set. */
export function getEnvVar(key: string, fallback?: string): string | undefined {
  return readFromUiConfigShim(key) ?? readFromImportMetaEnv(key) ?? readFromProcessEnv(key) ?? fallback;
}
