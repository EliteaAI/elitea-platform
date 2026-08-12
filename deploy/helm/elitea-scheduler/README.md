# elitea-scheduler Helm chart

Headless worker. No ingress, no product traffic, one replica.

## Retirement disposition — read before installing

`services/elitea-scheduler/RETIREMENT.md` records that **this process is not the
owner of product schedule occurrences**. The issue that asked for this chart
(#240) asked for that decision to be recorded here rather than for the chart to
be skipped, because retirement is *not* imminent: the binary carries three
separate responsibilities and only one of them is the deprecated part.

| Responsibility | Status | How it is controlled |
|---|---|---|
| Legacy `centry.schedule` poller (Redis tick lock → Pylon/Arbiter RPC) | **Deprecated.** `elitea-main`'s scheduling kernel owns planning/takeover/completion via `elitea_runtime.scheduled_job_cursors` + `scheduled_occurrences`. | **No env flag.** `main.go` always calls `sched.Run`. Which jobs it touches is decided by *data*: the `enabled` flag on `centry.schedule` rows. |
| Price-catalog sync (design §8.8) | Retained, no relocation decision yet. | `PRICE_SYNC_ENABLED` (default `false`) |
| Budget write-back consumer (design §8.6) | Retained, no relocation decision yet. | `BUDGET_WRITEBACK_ENABLED` + `GATEWAY_NATS_URL` (both unset ⇒ off) |

The two retained consumers are precisely why the image cannot be deleted, and
RETIREMENT.md explicitly declines to claim that relocation work is done.

**The operational consequence for this chart:** installing it starts the legacy
poller unconditionally. If a job is registered in `elitea-main` *and* its
`centry.schedule` row is still enabled, you get two clocks for that job — which
RETIREMENT.md forbids. The hybrid deployment handles this by disabling the
`index_scheduling` row in the database. Verify your `centry.schedule` rows
before installing; the chart cannot check this for you.

## Probes

`/healthz` pings the database (`internal/health/health.go`), so it is a
**readiness** signal. Liveness is a dependency-free `tcpSocket` check on the
same port — an httpGet liveness probe here would restart the pod on every
Postgres blip, which is the trap fixed for the gateway in issue #242.

## No HorizontalPodAutoscaler

Deliberate. Every unit of work is serialised behind a Redis tick lock or a
single durable NATS consumer, so replicas add cost and lock contention without
adding throughput. Set `replicaCount` by hand if a measured reason appears.

## Install

```bash
kubectl create secret generic elitea-scheduler-secrets \
  --from-literal=rpc-hmac-key="$RPC_HMAC_KEY" -n elitea

helm install elitea-scheduler deploy/helm/elitea-scheduler -n elitea \
  --set env.DATABASE_URL="postgres://…" \
  --set env.REDIS_URL="redis:6379"
```

`REDIS_URL` is a bare `host:port` (it is passed straight to
`goredis.Options.Addr`), **not** a `redis://` URL.

If you enable the budget write-back consumer, `GATEWAY_NATS_URL` must be the
FQDN — NATS lives in the `elitea-gateway` namespace while this chart's ArgoCD
Application targets `elitea`, and the short name does not resolve across
namespaces:
`nats://nats.elitea-gateway.svc.cluster.local:4222`.
