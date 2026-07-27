import { z } from 'zod';

/**
 * Runtime-config contract (spec §7.1 rows C7/C7b; §9.3 unit F3).
 *
 * The schema is the CLOSED key set: exactly the five C7 keys are honoured,
 * and nothing else is ever read from any C6 source. That closedness is also
 * how C7b is enforced — `vite_dev_token` and `dev` (removed by D10 for
 * leaking a static bearer into a world-readable config.js) have no schema
 * field, so no code path can read or surface them, and the inferred Config
 * type carries no index signature they could leak through.
 *
 * Required-vs-optional split is old-app parity: constants.js:31-37 declares
 * exactly VITE_SERVER_URL / VITE_BASE_URI / VITE_PUBLIC_PROJECT_ID as the
 * MISSING_ENVS trio; the two socket keys were always allowed to be absent.
 * Values are plain strings (the nginx heredoc emits strings; the old app
 * never constrained the format, so neither do we).
 */
export const ConfigSchema = z.object({
  vite_server_url: z.string(),
  vite_base_uri: z.string(),
  vite_socket_server: z.string().optional(),
  vite_socket_path: z.string().optional(),
  vite_public_project_id: z.string(),
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
