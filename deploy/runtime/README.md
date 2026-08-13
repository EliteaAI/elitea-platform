# The runtime plane — what `ELITEA_RUNTIME_ENABLED=true` actually costs

This directory holds the non-secret half of the runtime plane for the full
standalone stack: the TLS Redis config, the production auth config, and the two
scripts that install generated material and pre-create the dispatch streams. The
secret half is minted by [`../scripts/gen-runtime-certs.sh`](../scripts/gen-runtime-certs.sh)
into `deploy/certs/runtime/`, which is gitignored and must stay that way.

Enabling the runtime is what turns on the agent-execution HTTP surface — POST
`/api/v2/elitea_core/messages/prompt_lib/{projectID}/{conversationID}` returning
`{events_url}`, and the SSE stream at
`/api/v2/executions/{projectID}/{executionID}/events`. Nothing else registers
those routes.

It is not a feature flag. `internal/runtimecomposition/config.go` reads the
whole env block all-or-nothing and refuses to boot on a partial one, and each
piece pulls in real provisioning. Read this before setting the flag anywhere
else.

## The six things it drags in

1. **TLS Redis, not the plaintext one.** Agent dispatch is Redis Streams —
   `internal/transport/redisdispatch/agent.go` does the `XADD`; there is no NATS
   in this path. `ELITEA_RUNTIME_REDIS_URL` must be `rediss://` with an ACL
   username, no password in the URL (it comes from `_REDIS_PASSWORD_FILE`), and
   an explicit `/0` database. The client pins `MinVersion: TLS 1.3`.
2. **Three mTLS listeners, not one.** Control gRPC `:9443`, output gRPC `:9444`,
   content HTTPS `:9445`, each with its own `_TLS_CERT_FILE`, `_TLS_KEY_FILE`
   and `_TLS_CLIENT_CA_FILE`. All three demand
   `RequireAndVerifyClientCert` — a listener that accepts an anonymous client is
   a misconfiguration, not a relaxed mode.
3. **A worker certificate with exactly one SAN.**
   `internal/auth/workloadidentity` accepts one SPIFFE URI SAN *or* one DNS SAN
   and never falls back to CommonName. Email SANs, IP SANs, several DNS names,
   or a mix of URI and DNS are all rejected. A cert with **no** SAN — which is
   what `gen-gateway-certs.sh` produces for the gateway hop — cannot be reused
   here.
4. **An Ed25519 command-signing keypair.** `ELITEA_RUNTIME_SIGNING_KEY_FILE`
   must be one PKCS#8 `PRIVATE KEY` PEM block and nothing else; the public half
   must appear in the verification keyring JSON under exactly
   `ELITEA_RUNTIME_SIGNING_KEY_ID`. Composition cross-checks the two and refuses
   to start on a mismatch.
5. **Production authentication.** `cmd/elitea-main/main.go:686-688` rejects
   `ELITEA_RUNTIME_ENABLED=true` unless a `PrincipalValidator` and a
   `ForwardedIdentityVerifier` are composed, and those exist only in the
   `ELITEA_AUTH_CONFIG_FILE` branch. See [`auth.form.yml`](auth.form.yml) for
   why that means configuring a Form provider nobody signs in through.
6. **`ELITEA_CONFIGURATIONS_ENABLED=true`.** Agent dispatch composes through
   `dependencies.CurrentConfigurations`, which is nil unless configurations are
   enabled; it then fails a layer deep rather than at a guard. It also needs
   `ELITEA_AI_PROJECT_ID`.

Plus one ordering constraint that is easy to miss: composition verifies the
**shared migration head** at boot. A stack that applies its schema after
bringing services up will crash-loop elitea-main until it does. The standalone
compose therefore runs `db-init` and `elitea-migrate` as services rather than as
steps inside `seed`.

## File permissions are part of the contract

Everything above is read through `internal/security/securefile`, which requires
an absolute, canonical, non-symlink path and enforces exact permission bits:

| Material | Profile | Allowed mode |
|---|---|---|
| private keys, passwords, keyring signing key, vault key, form users | `PrivateMaterial` | owner-only (`0600`/`0400`) |
| CA certs, server certs, verification keyring, auth config | `PublicMaterial` | not executable, not group/other writable |

It also rejects two references that resolve to one file, or that carry equal
bytes — so each secret must be generated independently at random rather than
derived from one seed.

This is why compose does **not** bind-mount `deploy/certs/runtime` into the
services. Under rootless podman a bind-mounted host file arrives owned by
container uid 0, so a `0600` file is unreadable by elitea-main (distroless
`nonroot`, uid 65532) or redis (uid 999) — and "chmod 644 on the host" is not a
fix, because `PrivateMaterial` rejects any group/other bit.
[`install-material.sh`](install-material.sh) copies into per-consumer named
volumes instead, where owner and mode can be set independently, and gives each
consumer only the material it needs.

## Consumer groups are created by the control plane

The worker's Redis ACL user deliberately has no `XGROUP`. A consumer that can
create its own group can, after losing one, recreate it at the stream head and
silently skip every command in flight. [`bootstrap-streams.sh`](bootstrap-streams.sh)
creates them from `0-0` as a bootstrap user that can do nothing else.

## Workload sessions are provisioned, never self-registered

`WorkloadSessionsRepository` exposes no registration endpoint and no fallback
allowlist: a worker's calls are authorized against a row in
`elitea_runtime.workload_sessions` matching its certificate identity, session id
and producer id, all three checked in one query. Nothing in the repository
inserts that row — the deployment control plane must, which for this stack is
`standalone-stack.sh seed-runtime`.

## Verifying it

```bash
deploy/scripts/standalone-stack.sh certs
deploy/scripts/standalone-stack.sh up
deploy/scripts/standalone-stack.sh seed
deploy/scripts/standalone-stack.sh seed-runtime
deploy/scripts/standalone-stack.sh check
```

Note what `check` does **not** assert, and why. The intuitive probe — "POST
`…/messages/…` must not be 404" — does not discriminate: auth runs before route
matching, so every `/api/v2` path answers 401 to an unauthenticated caller
whether or not the route is registered. Measured on a runtime-disabled stack,
`GET`/`POST`/`PUT`/`DELETE` on both the messages and events paths all return 401
too. Authenticating does not rescue it either, because the runtime routes carry
no session-cookie fallback (`internal/api/production_runtime.go:31-37`).

The signals that do separate the cases are the ones `check` uses: the three mTLS
listeners (with the runtime off, nothing binds 9443/9444/9445 and the probe gets
ECONNREFUSED rather than a TLS handshake), the consumer group, the active
workload-session row, and elitea-main's `runtime_enabled=true` boot log.

## What still does not work

An admitted execution streams no tokens: `services/elitea-worker-python` is not
in this stack yet (#282), and Go has no native agent-token producer — it only
projects and serves the events. The worker's material is already minted and
installed into `standalone_runtime_worker`, so adding the service is a
compose-only change. The web chat surface also still emits into a noop socket.io
client rather than subscribing to `{events_url}`; that port is #93.
