/**
 * Environment variable helper for the maintenance entry point.
 *
 * The old Maintenance-UI used a shared `@/utils/env` module that checked
 * `globalThis.elitea_ui_config`, `import.meta.env`, `globalThis.__ENV__`, and
 * `process.env` in sequence. This is a minimal standalone version.
 */

/** Read an environment variable, checking multiple fallback sources in priority
 * order. Returns `undefined` when the variable is not set. */
export function getEnvVar(key: string, fallback?: string): string | undefined {
  // 1. elitea_ui_config shim (used by the Go adminui handler for injection)
  const anyGlobal = globalThis as unknown as Record<string, unknown>;
  const cfg =
    typeof anyGlobal.elitea_ui_config === 'object' && anyGlobal.elitea_ui_config !== null
      ? (anyGlobal.elitea_ui_config as Record<string, string>)
      : undefined;
  if (cfg && typeof key.toLowerCase() === 'string' && key.toLowerCase() in cfg) {
    return cfg[key.toLowerCase()];
  }

  // 2. Vite's import.meta.env (build-time injected)
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && key in import.meta.env) {
      return (import.meta.env as Record<string, string>)[key];
    }
  } catch {
    // import.meta unavailable — continue to next fallback
  }

  // 3. process.env (Node / Jest)
  if (typeof process !== 'undefined' && process.env && key in process.env) {
    return process.env[key];
  }

  return fallback;
}
