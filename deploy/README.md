# `deploy/` — how EliteA is deployed

Two delivery paths, deliberately not one:

- **compose** (`docker-compose*.yml`) — local development, E2E and the
  standalone full stack. Runs the whole topology on one host.
- **Helm + ArgoCD** (`helm/`, `argocd/`) — Kubernetes. Composition is
  **app-of-apps**, not an umbrella chart.

> This machine uses **podman**: `podman compose up -d`, not `docker compose`.

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
- **No secrets.** Every chart sources sensitive values from Kubernetes Secrets
  that must be provisioned out-of-band. `elitea-main`'s and the gateway's
  `GATEWAY_IDENTITY_SECRET` are `optional: false` — pods do not start without
  them, and the two sides must carry the **same** value.
- **No model-cache pre-seed for `pylon-indexer`.** compose's `model-cache-init`
  has no Kubernetes equivalent here.

## CI

`.github/workflows/helm-lint.yml` lints every chart under `deploy/helm/`,
`helm template`s each one (with its values files where they exist), and
`kubectl apply --dry-run=client`s every ArgoCD Application. A new chart is
picked up by the lint loop automatically but must be added to the template
matrix.
