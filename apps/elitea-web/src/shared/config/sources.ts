import type { ConfigKey } from './schema';

/**
 * The C6 sources (spec §7.1), in contract order:
 *
 *   window.elitea_ui_config → import.meta.env → globalThis.__ENV__ → process.env
 *
 * The FIRST source that DEFINES a key wins, per key — even when the defined
 * value is `undefined` (an own-property hit in the runtime config shadows
 * every later source, exactly like the old getEnvVar; env.js:12-14 returns
 * the hasOwnProperty hit unconditionally).
 *
 * Key-casing parity with apps/elitea-ui/src/utils/env.js:4-33: the runtime
 * config object is read with the lower-cased C7 key (env.js:12 — the nginx
 * heredoc emits lowercase keys, Containerfile.elitea-ui:50-54), while the
 * three env-var sources (2-4) are read with whatever exact string the old
 * CALL SITE passed as `key` — env.js:18,25,29 use `key` verbatim, no case
 * transform ever happens inside getEnvVar itself. Five of the six C7 keys
 * were called as `getEnvVar('VITE_SERVER_URL')` etc. (upper-case); the sixth,
 * `allow_project_own_llms`, was called as `getEnvVar('allow_project_own_llms',
 * true)` (constants.js:15) — already lower-case, unlike its siblings. `ENV_VAR_NAME`
 * below records the exact string each key's old call site used, so sources
 * 2-4 reconstruct the real lookup instead of assuming one casing for all six.
 *
 * Deviations from env.js, none observable in a browser:
 *  - env.js checks `globalThis.elitea_ui_config` before `window.…` (its
 *    "source 1" is really globalThis-then-window); in every browser and in
 *    jsdom `window === globalThis`, so C6's "window.elitea_ui_config" label
 *    and env.js agree. We reproduce the globalThis-first probe.
 *  - env.js wraps import.meta in try/catch for Jest-era Node AND guards on
 *    `import.meta.env &&` (env.js:18); both are dropped. This app is
 *    Vite-only (vite build + vitest): Vite always defines import.meta.env in
 *    the bundle, and vitest installs it as a Proxy at worker init, so
 *    neither the catch nor the truthiness branch is reachable — they would
 *    be untestable dead code, and §6.3's coverage floor has no exemption to
 *    hide them behind.
 *  - env.js reads the bare `process` binding behind a typeof guard; we read
 *    `globalThis.process` so the browser bundle needs no guard at all
 *    (same observable: no process ⇒ the source is skipped).
 *  - a truthy non-object source (e.g. globalThis.__ENV__ = 'x') made the old
 *    `key in …` check THROW; here it is treated as "source absent" (§3.6 —
 *    errors are values at the boundary). Functions are NOT part of this
 *    deviation: `in`/hasOwnProperty work fine on them, so asRecord() accepts
 *    them and their own keys are read exactly as the old code read them.
 */

export interface SourceHit {
  /** Which C6 source defined the key — used in diagnostic `reasons`. */
  readonly source: string;
  /** The raw value exactly as found; NOT yet validated. */
  readonly value: unknown;
}

interface ConfigSource {
  readonly name: string;
  read(key: ConfigKey): { readonly value: unknown } | undefined;
}

const globals = globalThis as unknown as Record<string, unknown>;

/**
 * Anything whose own keys can be read the way env.js read them. Functions
 * qualify: `key in fn` and hasOwnProperty(fn, key) are both well-defined, and
 * the old code would have read an `elitea_ui_config` function's own keys, so
 * excluding them here would be a silent behaviour divergence.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return (typeof value === 'object' || typeof value === 'function') && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * The exact string each key's old `getEnvVar(...)` call site passed as its
 * `key` argument (constants.js:5-16) — used verbatim by sources 2-4, which
 * never transform casing themselves.
 */
const ENV_VAR_NAME: Record<ConfigKey, string> = {
  vite_server_url: 'VITE_SERVER_URL',
  vite_base_uri: 'VITE_BASE_URI',
  vite_socket_server: 'VITE_SOCKET_SERVER',
  vite_socket_path: 'VITE_SOCKET_PATH',
  vite_public_project_id: 'VITE_PUBLIC_PROJECT_ID',
  allow_project_own_llms: 'allow_project_own_llms',
};

/** env.js:6-11 — truthy globalThis.elitea_ui_config first, then window's. */
function runtimeConfigHolder(): Record<string, unknown> | undefined {
  const fromGlobalThis = globals['elitea_ui_config'];
  if (fromGlobalThis) {
    return asRecord(fromGlobalThis);
  }
  const win = asRecord(globals['window']);
  const fromWindow = win?.['elitea_ui_config'];
  return fromWindow ? asRecord(fromWindow) : undefined;
}

/**
 * Module-scope array so the C6 order is written down exactly once; both
 * production resolution and the shadowing-matrix tests exercise this list.
 */
const CONFIG_SOURCES: readonly ConfigSource[] = [
  {
    // C6 source 1 — the /app/config.js runtime object (contract C5).
    name: 'window.elitea_ui_config',
    read(key) {
      const config = runtimeConfigHolder();
      if (config === undefined) {
        return undefined;
      }
      // hasOwnProperty, not `in`: env.js:12 parity — inherited keys do not
      // count, but an own key set to `undefined` does (and shadows below).
      return Object.prototype.hasOwnProperty.call(config, key)
        ? { value: config[key] }
        : undefined;
    },
  },
  {
    // C6 source 2 — build-time env (env.js:17-23).
    name: 'import.meta.env',
    read(key) {
      const env = import.meta.env as Record<string, unknown>;
      const envName = ENV_VAR_NAME[key];
      return envName in env ? { value: env[envName] } : undefined;
    },
  },
  {
    // C6 source 3 — custom-host escape hatch (env.js:24-27).
    name: 'globalThis.__ENV__',
    read(key) {
      const env = asRecord(globals['__ENV__']);
      if (env === undefined) {
        return undefined;
      }
      const envName = ENV_VAR_NAME[key];
      return envName in env ? { value: env[envName] } : undefined;
    },
  },
  {
    // C6 source 4 — Node fallback (env.js:28-31).
    name: 'process.env',
    read(key) {
      const proc = asRecord(globals['process']);
      const env = proc === undefined ? undefined : asRecord(proc['env']);
      if (env === undefined) {
        return undefined;
      }
      const envName = ENV_VAR_NAME[key];
      return envName in env ? { value: env[envName] } : undefined;
    },
  },
];

/** Resolve one key across the C6 sources — first definition wins. */
export function readConfigKey(key: ConfigKey): SourceHit | undefined {
  for (const source of CONFIG_SOURCES) {
    const hit = source.read(key);
    if (hit !== undefined) {
      return { source: source.name, value: hit.value };
    }
  }
  return undefined;
}
