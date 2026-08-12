# pylon-indexer Helm chart

The retained Pylon runtime hosting the indexing plugins. **Not** a
target-architecture service — it exists until the index path is fully
replatformed (see `deploy/INDEX_V2_CUTOVER.md`). This chart packages the
topology `deploy/docker-compose.yml` already runs; it does not extend it.

## Known gaps, stated rather than hidden

- **No model-cache pre-seed.** In compose, the `model-cache-init` service
  populates the shared `pylon_cache` volume before the indexer starts. This
  chart has no equivalent, so a fresh pod downloads what it needs on first use
  and requires egress to do so. Turn on `persistence.enabled` to keep that
  cache across pod replacements (the PVC carries
  `helm.sh/resource-policy: keep`, so `helm uninstall` does not throw the cache
  away).
- **`/healthz` is upstream.** It comes from the `ghcr.io/eliteaai/pylon` base
  image, so whether it touches Postgres/Redis cannot be verified in this
  repository. It is wired to liveness because the compose `HEALTHCHECK`
  already does; if it proves dependency-coupled (the way `elitea-scheduler`'s
  is), a database blip will restart the pod — set `probes.liveness.enabled:
  false` for readiness-only in that case.
- **`configs/` and `pylon.yml` are baked in.** The Containerfile notes they are
  overridable by volume mount / ConfigMap; this chart does not expose that.
  Add a ConfigMap mount if an environment needs different plugin config.
- **Single replica, `Recreate`.** The indexing plugins coordinate through
  Redis/Postgres state this chart does not model, and a ReadWriteOnce cache PVC
  cannot be mounted twice. There is deliberately no HPA.

## Secrets

`RPC_HMAC_KEY` must hold the **same value** as
`deploy/helm/elitea-scheduler`'s `secrets.RPC_HMAC_KEY` — the scheduler signs
the RPC payloads this runtime verifies. Every key in the `secrets:` block is
`optional: true` because Pylon starts without them, but that is a *downgrade*
(unsigned messages, empty password), not a pass. Provision the Secret:

```bash
kubectl create secret generic pylon-indexer-secrets -n elitea \
  --from-literal=postgres-password=… \
  --from-literal=redis-password=… \
  --from-literal=indexer-hmac-key=… \
  --from-literal=event-hmac-key=… \
  --from-literal=rpc-hmac-key=… \
  --from-literal=litellm-master-key=…
```

## Install

```bash
helm install pylon-indexer deploy/helm/pylon-indexer -n elitea \
  --set env.POSTGRES_HOST=postgres --set env.REDIS_HOST=redis
```
