import { z } from 'zod';

/**
 * Runtime-config contract (spec §7.1 rows C7/C7b; §9.3 unit F3).
 *
 * The schema is the CLOSED key set: exactly the six honoured C7 keys are
 * read, and nothing else is ever read from any C6 source. That closedness is
 * also how C7b is enforced — `vite_dev_token` and `dev` (removed by D10 for
 * leaking a static bearer into a world-readable config.js) have no schema
 * field, so no code path can read or surface them, and the inferred Config
 * type carries no index signature they could leak through.
 *
 * Required-vs-optional split is old-app parity: constants.js:31-37 declares
 * exactly VITE_SERVER_URL / VITE_BASE_URI / VITE_PUBLIC_PROJECT_ID as the
 * MISSING_ENVS trio; the two socket keys and `allow_project_own_llms` were
 * always allowed to be absent. Values are plain strings (the nginx heredoc
 * emits strings; the old app never constrained the format, so neither do we)
 * except `allow_project_own_llms` — see below.
 *
 * §7.1 C7 as originally written enumerates only 5 keys; unit R1 found the
 * gap while porting `IntegrationGuard.jsx` faithfully (it reads a 6th key,
 * `allow_project_own_llms`) and flagged it rather than editing this
 * (F3-owned) file — a genuine spec under-enumeration, not an F3 defect: F3
 * built exactly the 5 keys §7.1 specified. `allow_project_own_llms` is
 * folded in here as the fix.
 *
 * `allow_project_own_llms` is intentionally `z.unknown()`, NOT
 * `z.boolean()`/`z.coerce.boolean()`: old app —
 * `ALLOW_PROJECT_OWN_LLMS = getEnvVar('allow_project_own_llms', true)`
 * (constants.js:15) — and its sole consumer, `IntegrationGuard.jsx:13`, does
 * a STRICT `=== false` comparison with no coercion, so a source-provided
 * string `"false"` is truthy-for-this-purpose in the old app (N4: reproduce
 * documented behaviour, however surprising, don't silently fix it). Any
 * coercing schema would change that observable behaviour. `.default(true)`
 * reproduces getEnvVar's fallback: when no source defines the key at all,
 * the resolved value is the literal `true` the old call site passed as its
 * fallback argument.
 *
 * One accepted, documented simplification: zod's `.default()` cannot
 * distinguish "no source defines the key" from "a source defines the key as
 * literal JS `undefined`" — both look like `undefined` to the schema, so
 * both resolve to `true`. The old getEnvVar returns actual `undefined` (not
 * the fallback) in the second, exceedingly narrow case (a config source
 * would have to literally set `allow_project_own_llms: undefined`). This is
 * unobservable through the only consumer: `undefined === false` and
 * `true === false` are both `false`, so IntegrationGuard behaves identically
 * either way. Not worth the extra machinery a faithful reproduction would
 * need (§3.6 pragmatism).
 */
export const ConfigSchema = z.object({
  vite_server_url: z.string(),
  vite_base_uri: z.string(),
  vite_socket_server: z.string().optional(),
  vite_socket_path: z.string().optional(),
  vite_public_project_id: z.string(),
  allow_project_own_llms: z.unknown().optional().default(true),
});

/** The typed, frozen object config consumers receive. */
export type Config = Readonly<z.infer<typeof ConfigSchema>>;

export type ConfigKey = keyof z.infer<typeof ConfigSchema>;

/**
 * The keys whose absence makes the app unusable — derived from the schema's
 * optionality so the schema stays the single source of truth for both the
 * key set (C7) and the required trio (old MISSING_ENVS).
 */
export type RequiredConfigKey = {
  [K in ConfigKey]-?: undefined extends z.infer<typeof ConfigSchema>[K] ? never : K;
}[ConfigKey];

/** C7 keys in contract order (drives per-key resolution and `missing` order). */
export const CONFIG_KEYS = Object.keys(ConfigSchema.shape) as readonly ConfigKey[];
