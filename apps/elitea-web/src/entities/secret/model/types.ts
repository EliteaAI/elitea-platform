/**
 * Secret domain type — a project secret (write-only value store). No
 * OpenAPI schema exists for this resource (settings domain, not in the W2
 * manifest).
 *
 * Evidence: apps/elitea-ui/src/api/secrets.js:12-71 — `secretsList` (GET,
 * rows carry `name`/`secret_name`/`is_default`, **never the plaintext**);
 * `secretShow` (GET single, `data.value`/`data.secret_name` — the plaintext,
 * revealed on demand); apps/elitea-ui/src/[fsd]/features/settings/ui/
 * secrets/SecretsContent.jsx:48-56 — row field usage.
 */
export interface Secret {
  readonly name: string;
  /** Masked/reference display value — the list endpoint never returns the plaintext. */
  readonly secretName: string;
  readonly isDefault: boolean;
}

/** `secretShow` response — the plaintext, fetched only on explicit reveal. */
export interface RevealedSecret {
  readonly value: string;
  readonly secretName: string;
}
