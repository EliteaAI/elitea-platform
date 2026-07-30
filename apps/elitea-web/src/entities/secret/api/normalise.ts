/**
 * Normalise wire-shaped secret entries into the domain `Secret` model.
 *
 * Wire shape from `handler.go:114-120` — each list item is a JSON object
 * with `secret_name` (masked display value), `name` (canonical identifier),
 * and `is_default` (boolean flag).
 */
import type { Secret } from '../model/types';

export function normaliseSecrets(wire: ReadonlyArray<unknown>): Secret[] {
  return wire.map((item) => {
    const obj = item as Record<string, unknown>;
    return {
      name: String(obj.name ?? ''),
      secretName: String(obj.secret_name ?? obj.name ?? ''),
      isDefault: Boolean(obj.is_default),
    };
  });
}
