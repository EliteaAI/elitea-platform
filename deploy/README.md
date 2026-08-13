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
  3. leave the hop on plain HTTP inside the cluster and accept it.
  Note this hop is **not** wired end-to-end today regardless of namespace:
  elitea-main reads `LLM_GATEWAY_CLIENT_CERT` as a *file path*
  (`cmd/elitea-main/main.go:876` → `llmproxy.Config.ClientCertFile`), while its
  chart injects that variable as Secret *contents* via `secretKeyRef` and
  mounts no volume. Fixing that is elitea-main chart work, out of scope here.
- **No secrets.** Every chart sources sensitive values from Kubernetes Secrets
  that must be provisioned out-of-band. `elitea-main`'s and the gateway's
  `GATEWAY_IDENTITY_SECRET` are `optional: false` — pods do not start without
  them, and the two sides must carry the **same** value.
- **No model-cache pre-seed for `pylon-indexer`.** compose's `model-cache-init`
  has no Kubernetes equivalent here.

## CI

`.github/workflows/helm-lint.yml` has three jobs:

1. **Helm Lint** — `helm lint` over every chart under `deploy/helm/`. New
   charts are picked up automatically.
2. **Helm Template (per chart)** — `helm template` with the chart's values
   files, *and* a second pass with its non-default toggles (HPA, PVC, optional
   Services and probes, hook Jobs render zero objects otherwise, so a break in
   them would be invisible). Both passes are validated with `kubeconform
   -strict`. A new chart must be **added to this matrix** by hand.
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
