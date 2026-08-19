# `deploy/` — how EliteA is deployed

Two delivery paths, deliberately not one:

- **compose** (`docker-compose*.yml`) — local development, E2E and the
  standalone full stack. Runs the whole topology on one host.
- **Helm + ArgoCD** (`helm/`, `argocd/`) — Kubernetes. Composition is
  **app-of-apps**, not an umbrella chart.

> This machine uses **podman**: `podman compose up -d`, not `docker compose`.

Agent execution (the chat send path) is gated on `ELITEA_RUNTIME_ENABLED`, which
is a provisioning exercise rather than a flag — TLS Redis, three mTLS listeners,
a SAN-bearing workload certificate, an Ed25519 signing keyring, production auth
and a workload-session row. [`runtime/README.md`](runtime/README.md) documents
that contract and the permission rules its material must satisfy.

## Composition decision (issue #240)

`deploy/helm/elitea-platform/` used to be an empty `.gitkeep` — an umbrella
chart that was scaffolded and never built. It has been **removed**. The single
composition mechanism is `deploy/argocd/app-of-apps.yaml`, which renders every
Application in `deploy/argocd/applications/` and syncs them in sync-wave order.
Two mechanisms would mean two places to add a service and two answers to "what
is deployed"; there is now one.

```bash
kubectl apply -f deploy/argocd/app-of-apps.yaml
```

`kubectl apply -f deploy/argocd/` reaches only that file — kubectl does not
recurse — which is the intended behaviour: the children are created by ArgoCD.

## Chart × service × status

| Chart (`deploy/helm/`) | Service / image | ArgoCD Application | Wave | Namespace | Status |
|---|---|---|---|---|---|
| `nats` | upstream NATS JetStream | `applications/nats.yaml` | -2 | `elitea-gateway` | **Production reference.** scale-1 profile by default; `values-ha.yaml` for HA. |
| `nats-bootstrap` | JetStream KV buckets + stream (Job) | `applications/nats-bootstrap.yaml` | -1 | `elitea-gateway` | **Production reference.** Idempotent Helm hook; HA needs `replicas=3`. |
| `elitea-llm-gateway` | `ghcr.io/eliteaai/elitea-llm-gateway` | `applications/elitea-llm-gateway.yaml` | 0 | `elitea-gateway` | **Mature — the conventions reference for new charts.** mTLS-only ClusterIP, custom-metric HPA, NetworkPolicy opt-in. |
| `elitea-main` | `ghcr.io/eliteaai/elitea-main` | `applications/elitea-main.yaml` | 1 | `elitea` | **Prototype values** (self-labelled). Ships the migration hook Job; no TLS ingress, no NetworkPolicy, no split DB principals. |
| `elitea-scheduler` | `ghcr.io/eliteaai/elitea-scheduler` | `applications/elitea-scheduler.yaml` | 2 | `elitea` | **New. Retirement caveat — read the chart README.** Legacy poller starts unconditionally; the two retained workers are off by default. |
| `pylon-indexer` | `ghcr.io/eliteaai/pylon-indexer` | `applications/pylon-indexer.yaml` | 2 | `elitea` | **New. Legacy-by-design**, retained until the index path is replatformed (`INDEX_V2_CUTOVER.md`). No model-cache pre-seed. |
| `elitea-web` | `ghcr.io/eliteaai/elitea-web` | `applications/elitea-web.yaml` | 3 | `elitea` | **New.** Static SPA behind nginx. In-cluster only until an ingress exists. |
| — | `ghcr.io/eliteaai/elitea-ui` | — | — | — | **No chart.** The old UI is published and runs in compose; the Kubernetes path is `elitea-web`. |
| — | `services/elitea-worker-python` | — | — | — | **No chart, deliberately.** That plane is `pending` in the workspace `repos.yaml` — packaging it would guess at an unsettled contract (issues #240, #244). |
| — | PostgreSQL, Redis | — | — | — | **Not provisioned here.** External prerequisites; see below. |

Sync waves follow the issue's ordering — nats → migrations → backend →
frontend. Migrations are not their own wave: `elitea-main`'s chart runs them as
a `pre-install,pre-upgrade` Helm hook Job, and Helm blocks the release until it
completes, so the ordering is enforced *inside* wave 1.

## Distribution — the charts are published to GHCR as OCI artifacts

Every chart in the table above is packaged and pushed on each release by the
`chart` job in `.github/workflows/publish.yml`, next to the images:

```
oci://ghcr.io/eliteaai/charts/<chart>
```

Install without cloning this repository:

```bash
helm install elitea-main oci://ghcr.io/eliteaai/charts/elitea-main --version 1.2.3
```

Four properties of the published artifact that the in-repo chart does not have:

- **`--version` is required in practice.** There is no `latest` chart tag, and
  there will not be one: an OCI chart reference resolves by SemVer, so a
  non-SemVer tag is a foot-gun for every tool that enumerates the repository.
  The in-repo `Chart.yaml` files all stay at the placeholder `0.1.0`; only the
  packaged artifact carries a release number.
- **`image.tag` defaults to the chart version**, for the five charts whose
  image this repository publishes. The in-repo default is `"latest"` with
  `pullPolicy: IfNotPresent`, which means a node holding an older cached
  `latest` layer keeps serving it — the release job stamps the tag at package
  time so the published chart cannot install that way.
- **`appVersion` tracks the platform release** for those same five charts. The
  charts that deploy a third-party image (`nats`, `nats-bootstrap`,
  `otel-collector`) keep their deliberate upstream pin, because a platform
  release number means nothing to those images' registries.
- **Charts are cosign-signed**, keyless, exactly as the images are:

  ```bash
  cosign verify ghcr.io/eliteaai/charts/elitea-main:1.2.3 \
    --certificate-identity-regexp '^https://github.com/eliteaai/elitea-platform/' \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com
  ```

The job runs after the images are pushed and signed, so a chart never reaches
the registry referencing a tag that does not exist yet. If any part of a
release fails, the rollback job deletes the pushed charts along with the
images.

## Capability flags — what a Helm install serves (#382)

`cmd/elitea-main` gates whole capabilities on environment variables. Each
variable makes the composition root build a dependency, and the router
registers a route group only when that dependency exists.

The chart used to set **none** of them. So the same image served the pylon-free
configuration on compose and served none of it on Kubernetes — the platform
could run without pylon on compose and could not on Kubernetes, which is the
deployment target. `deploy/helm/elitea-main/values.yaml` now carries every
flag, and `deploy/helm/elitea-main/values-standalone.yaml` is the values file
whose capability set matches `docker-compose.standalone-full.yml`.

| Flag | Default install | `values-standalone.yaml` | Prerequisite |
|---|---|---|---|
| `ELITEA_ARTIFACTS_ENABLED` | on | on | object storage configured |
| `ELITEA_CONFIGURATIONS_ENABLED` | off | **on** | production authentication |
| `ELITEA_PROJECT_INFO_ENABLED` | off | **on** | production authentication |
| `ELITEA_AI_PROJECT_ID` | empty | **set** | must name a project that exists |
| `ELITEA_CONFIGURATIONS_MUTATION_ENABLED` | off | off | `ELITEA_CONFIGURATIONS_ENABLED` **and** `runtime.enabled` — read below |
| `ELITEA_INDEX_TYPES_ENABLED` | off | off | **must stay off** — issue #394 |
| `ELITEA_APPLICATION_SKILLS_ENABLED` | off | off | **must stay off** — issue #395 |
| `REDIS_URL` | empty | **set at install** | a Redis the cluster can reach |
| `ADMIN_UI_STATIC_DIR` | **set** | set | the image ships the bundle at it |
| `ELITEA_RUNTIME_ENABLED` and its block | off | **on** | production authentication **and** runtime material — read below |

Two flags stay off on purpose in **both** files. Their routes answer a shape
the published contract and the generated client both reject, so turning either
on breaks the web client. Issues #394 and #395 track the contract work that has
to land first.

### Why `ELITEA_CONFIGURATIONS_MUTATION_ENABLED` stays off

This row used to record the prerequisite as "needs the retired LiteLLM
lifecycle facade". That reason is gone. The configuration lifecycle takes no
LLM transport at all now — read the comment at the end of
`services/elitea-main/cmd/elitea-main/configurations_config.go` and the one at
the composition site in `cmd/elitea-main/main.go`. Issue #460 records the stale
row.

The flag stays off for two reasons that are true today.

1. **Its real prerequisites are larger than the flag.** The chart refuses the
   flag without `ELITEA_CONFIGURATIONS_ENABLED="true"` and without
   `runtime.enabled=true`, because the write routes dispatch a
   configuration-validation command. `values.yaml` has neither, so the default
   install cannot set the flag at all.
2. **The flag is not what makes a saved credential usable.** The flag composes
   a second write route, and that route wins the path when both are composed —
   see `TestConfigurationWriteRouteWinnerDependsOnTheMutationComposition` in
   `services/elitea-main/internal/api`. It is a different request contract from
   the one `apps/elitea-web` sends today, and its lifecycle reconciler writes
   `configuration.status_ok` asynchronously. The compatibility route that every
   install serves now writes `status_ok` itself, in the request, from the same
   admission decision the lifecycle uses (issue #457). Turning the flag on is
   therefore a separate cutover with its own web-client work, not a remedy for
   an invisible credential.

Prerequisites are checked while the chart renders, not when the pod starts. A
values file that turns a capability on without what it needs fails
`helm template` with a message naming the field and the Go source that would
otherwise refuse at boot. `deploy/helm/elitea-main/tests/render-capabilities.sh`
asserts all of this against the rendered YAML, and it reads the required
runtime names out of `internal/runtimecomposition/config.go`, so a newly
required name fails the gate until the chart renders it.

### The runtime plane, and how its material arrives

The runtime plane is agent execution, the execution-events stream, index
ingest, index scheduling and configuration validation. It is **all-or-nothing**:
`internal/runtimecomposition/config.go` requires about thirty names at once and
refuses to start on a partial set. The chart exposes the whole block under
`runtime:` and refuses a partial one at render time.

Its material — the signing key, the verification keyring, the Redis password,
the Redis CA and the three listener keypairs — comes from a **plain Kubernetes
Secret**. Set `runtime.material.secretName`, and give the Secret one key for
each of these names, which are the names `deploy/scripts/gen-runtime-certs.sh`
writes:

```
runtime-ca.crt                command-signing-key.pem
command-signing-keyring.json  redis-producer-password
control-server.crt   control-server.key
output-server.crt    output-server.key
content-server.crt   content-server.key
```

The three server certificates must carry the Service DNS name, because the
agent worker dials all three listeners through this chart's Service.

#### Why an init container copies the Secret (issue #404)

The runtime reads every one of those files through
`internal/security/securefile`, which refuses a path that resolves through a
symlink and requires **owner bits only** on private material. A Kubernetes
Secret volume gives neither:

- mounted whole, it is a symlink farm, so every path resolves through `..data/`
  and `securefile` refuses it;
- mounted per file with `subPath`, the files are real but owned by `root`,
  while this pod runs as nonroot — and the only modes that let a nonroot
  process read a root-owned file (`0440` with `fsGroup`, or `0444`) carry the
  group or other bits that `securefile` rejects.

So the chart adds an init container, `runtime-material`. It runs the **same
image** as the service, and therefore the **same user**. It copies each Secret
key into a memory-backed `emptyDir` at mode `0600`, and it removes anything in
that directory that the Secret does not carry. Every file it writes belongs to
the user that then reads it, and no `securefile` rule changes. The compose
stack answers the same problem in the same way; read
`deploy/runtime/install-material.sh`.

The init container then reads every installed file back through `securefile`,
with the same permission profile that the service applies. **A missing Secret
key stops the pod in the init container, with a message**, rather than in a
restart loop of the service.

The service container never mounts the Secret. It sees only the copies.

Two settings go with it:

- `runtime.material.secretDefaultMode` (default `0444`) is the mode the kubelet
  gives each Secret key. The init container has to read them, and the kubelet
  owns them as root, so without a pod `fsGroup` the read bit for other users is
  the only one that reaches this pod's user. Those bits apply inside this pod's
  own mount namespace; the copies that the service reads are owner-only. Set
  `podSecurityContext.fsGroup` and lower this to `0440` to tighten it. The
  chart refuses a mode that the pod could not read.
- `runtime.material.sizeLimit` (default `8Mi`) bounds the `emptyDir`.

`runtime.material.volume` remains, for a deployment whose material is
**already** real, owner-owned files at `runtime.material.mountPath` — a CSI
secret driver, for example. It is mutually exclusive with `secretName`, and it
renders no init container. Exactly one of the two is required.

Set `runtime.enabled: false` if you have no material yet. Everything else above
still works without it, and it is the larger half of the gap.

### The authentication material (issue #444)

Production authentication reads **five more files** through the same
`securefile`: the Auth Redis password, the Auth Redis CA, the browser-attempt
key, the PAT signing key and the Form users JSON. `runtime.enabled` requires
production authentication, so every Kubernetes install of the runtime plane
needs them.

Their paths are **not** chart values. They come from the authentication
configuration document, which is the operator's. So the chart could not know
them, rendered no volume for them, and no Kubernetes install could start from
the chart alone.

**Put the document in the chart.** `fileConfig.authConfig.document` takes the
whole authentication configuration. The chart then renders the ConfigMap for
you, reads the five paths out of it, and refuses — while it renders — a path
that `fileConfig.authConfig.material.mountPath` cannot serve.
`fileConfig.authConfig.configMapName` still points at a ConfigMap you provision
yourself, and the two are mutually exclusive. With the external ConfigMap the
chart cannot read the paths, so only the init container can check them.

The five files arrive in a **plain Kubernetes Secret**, named by
`fileConfig.authConfig.material.secretName`. **Its keys are yours, not the
chart's**: each key is the last component of one of the five paths in the
document. Unlike the runtime material, no script fixes those names.

The mechanism is the one issue #404 built, and there is only one copy of it —
`internal/security/materialinstall`. The init container `auth-material` runs the
same image and the same user as the service, copies each Secret key into a
memory-backed `emptyDir` at mode `0600`, removes anything the Secret does not
carry, and reads every file back through `securefile` before it exits.

One difference decides its arguments. The chart owns every runtime file name, so
`elitea-runtime-material` derives its whole destination from the ConfigMap. The
five authentication paths belong to the operator's document, so
`elitea-auth-material` **reads that document**: `-config` gives it the file the
service reads, and it derives the five paths and their directory from it.
`-mount` states what the pod mounts, and the command refuses a disagreement by
name.

`fileConfig.authConfig.material.mountPath` must differ from
`runtime.material.mountPath`, and the chart refuses one shared directory. Each
install container removes anything in its directory that its own Secret does not
carry, so one directory would make the two delete each other's files. Put a copy
of any shared file, such as the Redis CA, in both Secrets.

`fileConfig.authConfig.material.secretDefaultMode` and `.sizeLimit` behave
exactly like their `runtime.material` counterparts, and
`fileConfig.authConfig.material.volume` is the same alternative for a CSI secret
driver.

### `ELITEA_AI_PROJECT_ID` is set in two charts

`deploy/helm/elitea-main/values.yaml` and
`deploy/helm/elitea-llm-gateway/values.yaml` both carry this key, and **both
must name the same project**. elitea-main merges that project's configurations
into every other project's option lookups; the gateway reads it to serve the
shared models an operator publishes (issue #316). Empty on the gateway side
leaves shared models unreachable — the model picker offers them and the request
then finds no credential. Both ship empty, because an id naming a schema that
does not exist makes every credential read fail, so the operator must choose
one project and set it in both places.

## What a Kubernetes install does NOT give you

Stated plainly, because the gap between compose and Helm is where deploys break:

- **No PostgreSQL and no Redis.** No chart here provisions them. Wave 1's
  migration hook fails against a cluster where they don't already exist and
  where the charts' `DATABASE_URL` / `REDIS_URL` have not been pointed at them.
- **No ingress or HTTPRoute, and no securityContext hardening.** A separate
  issue owns both; the charts deliberately do not duplicate that work. Until
  it lands, `elitea-web` and `elitea-main` are reachable in-cluster only.
- **Cross-namespace DNS.** NATS and the gateway live in `elitea-gateway`; the
  rest live in `elitea`. Short names do not resolve across namespaces, so
  `LLM_GATEWAY_URL` and `GATEWAY_NATS_URL` must be FQDNs
  (`…​.elitea-gateway.svc.cluster.local`).
- **Cross-namespace *Secrets*, which DNS advice does not solve.** The gateway
  chart's cert-manager `Certificate` for the edge issues Secret
  `elitea-main-gateway-client-tls` **into the gateway's own namespace**
  (`elitea-gateway`), and its comment says elitea-main mounts it. Secrets are
  namespace-scoped, so elitea-main running in `elitea` **cannot read it**. To
  wire the elitea-main → gateway mTLS hop you must do one of:
  1. install elitea-main into `elitea-gateway` (override the Application's
     `destination.namespace`), or
  2. replicate the Secret into `elitea` (reflector/kubed, external-secrets, or
     a second `Certificate` in `elitea` from the same `elitea-internal-ca`
     ClusterIssuer — the issuer is cluster-scoped, so this works), or
  3. there is no third option: plain HTTP is **not** one.
     `internal/llmproxy/proxy.go` builds an mTLS transport whenever
     `Config.Transport` is nil, and nothing binds that field to an environment
     variable, so an `http://` gateway URL still loads a client keypair and
     still fails at boot without one.
  The mount itself is no longer missing. `LLM_GATEWAY_CLIENT_CERT` and its two
  siblings are *file paths* (`llmproxy.Config.ClientCertFile`), and issue #463
  moved them out of the `secrets:` block — where a `secretKeyRef` had been
  setting each variable to a PEM block instead of a path — without mounting
  anything at them, so every Kubernetes install with a gateway URL exited at
  boot. `fileConfig.llmGatewayClientMaterial` now mounts a Secret at the
  directory those paths live in, and the chart refuses, while it renders, a
  gateway URL with no material and a path the mount does not serve.
- **No secrets.** Every chart sources sensitive values from Kubernetes Secrets
  that must be provisioned out-of-band. `elitea-main`'s and the gateway's
  `GATEWAY_IDENTITY_SECRET` are `optional: false` — pods do not start without
  them, and the two sides must carry the **same** value. `pylon-indexer`'s
  `SECRETS_MASTER_KEY` is `optional: false` for the same reason, described
  next.
- **No model-cache pre-seed for `pylon-indexer`.** compose's `model-cache-init`
  has no Kubernetes equivalent here.

## `SECRETS_MASTER_KEY` — one key for the whole stack

`elitea-main`, `pylon-indexer` and `elitea-llm-gateway` all read
`centry.secrets_key`. Each one wraps a project key with `SECRETS_MASTER_KEY`
when it holds that value, and stores the project key in the clear when it does
not. Two services with two answers put two row formats in one table, and
neither can read what the other wrote.

So the rule is: **one stack, one value, given to every service that reads that
table.** Give it in the environment, never in a file. A committed default is a
second key source, and the one `pylon-indexer` used to ship is treated as
exposed (issue #418).

Set it to a base64url-encoded 32-byte Fernet key:

```bash
export SECRETS_MASTER_KEY=$(python3 -c \
  'import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())')
```

### The three states

The variable has three states. They are not equivalent:

| State | What `elitea-main` does | What is stored |
|---|---|---|
| Set, valid | Wraps each project vault key with the master key. | The key row is a Fernet token. |
| **Not set** | Starts, and writes a **warning** to the log. | The key row is the project key **in the clear**. Anyone who can read the database can open every project secret. |
| **Set, malformed** | **Refuses to start.** The message names the variable. | Nothing. |

A malformed key stops the service on purpose (#412). Before that change the
service ignored the bad value and stored the keys unwrapped. An operator who
set the variable got plaintext storage, and no report of it. The
`pylon-indexer` image refuses to start on a missing or malformed value in the
same way (`services/pylon-indexer/entrypoint.sh`).

A trailing newline is **not** malformed. Go and Python both ignore `\r` and
`\n` when they decode base64, so a key mounted from a file keeps working. A
stray space or tab **is** malformed.

### Which stack sets it

- `deploy/docker-compose.yml` requires the variable for both services that read
  the table, and compose fails if you do not export it (#418).
- `docker-compose.staging.yml` requires it from your shell, and compose fails
  if you do not export it.
- No chart under `deploy/helm/elitea-main/` sets it. Supply it through a
  Kubernetes Secret, or accept unwrapped storage.
- The E2E stack sets no key on purpose. It seeds unwrapped key rows, so it
  needs none.

### Changing the key

Rows written under a different key, or under no key, do not become readable
when the key changes. Convert them with
[`scripts/rewrap-centry-vault.py`](scripts/rewrap-centry-vault.py), on a copy
first. It rewraps the project key and never rewrites the secret values.

## CI

`.github/workflows/helm-lint.yml` has three jobs:

1. **Helm Lint** — `helm lint` over every chart under `deploy/helm/`. New
   charts are picked up automatically. The job also runs
   `deploy/helm/elitea-main/tests/render-capabilities.sh`, because `helm lint`
   never reads the rendered environment: it stayed green for as long as the
   chart set no capability flag at all (#382). Two coverage checks live here
   rather than in the jobs they guard: every chart directory must appear in
   the **Helm Template** matrix below or be excluded by name with a reason,
   and every chart directory must appear in the `chart` matrix of
   `publish.yml`. A chart that no release publishes is a chart nobody outside
   this repository can install, and neither `helm lint` nor the template
   matrix would ever go red for it.
2. **Helm Template (per chart)** — `helm template` with the chart's values
   files, *and* a second pass with its non-default toggles (HPA, PVC, optional
   Services and probes, hook Jobs render zero objects otherwise, so a break in
   them would be invisible). `elitea-main` gets a third pass with
   `values-standalone.yaml`, which renders the runtime material Secret volume,
   the material init container and the three runtime listener ports that no
   other pass produces. Every pass is
   validated with `kubeconform -strict`. A new chart must be **added to this
   matrix** by hand.
3. **ArgoCD Applications** — `kubeconform -strict` against the real
   `argoproj.io` Application CRD schema, plus structural checks that no schema
   can make: a stray manifest directly in `deploy/argocd/` that the root never
   renders, a `spec.source.path` pointing at a chart that does not exist, a
   non-Application manifest in `applications/`, and a child with no sync-wave.

Validation is `kubeconform`, **not** `kubectl apply --dry-run=client`, even
though the latter is what issue #240 asked for: that command needs API
discovery from a live cluster (`couldn't get current server API group list`)
and fails on a runner with no cluster, so it would gate nothing. kubeconform is
the offline equivalent and is strictly stronger — `-strict` rejects fields the
schema does not define, which client dry-run does not. Its CRD schema source is
pinned to a catalog release tag (`CRD_SCHEMAS` in the workflow), so CI does not
depend on a third-party branch.
