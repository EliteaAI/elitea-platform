# elitea-web Helm chart

Static SPA (`apps/elitea-web`) served by nginx. Deployment + Service +
ConfigMap, optional CPU HPA, PodDisruptionBudget.

## What the image actually serves

Everything lives under **`/app/`** — `apps/elitea-web/nginx/spa.conf` defines
five location blocks and **no `location /`**, so the container root returns 404.
That is why the probes target `/app/index.html` rather than `/`.

`config.js` is not baked into the image. `apps/elitea-web/docker-entrypoint.sh`
writes `window.elitea_ui_config` **at container start** from exactly five env
vars:

| env var | default here | note |
|---|---|---|
| `VITE_SERVER_URL` | `/api/v2` | relative ⇒ assumes one origin fronts this Service and elitea-main |
| `VITE_BASE_URI` | `/app/` | must match the image's hardcoded nginx paths |
| `VITE_SOCKET_SERVER` | `""` | |
| `VITE_SOCKET_PATH` | `/socket.io` | |
| `VITE_PUBLIC_PROJECT_ID` | `""` | |

Anything else added to `.Values.env` reaches the container's environment but is
never emitted into `config.js`.

Because that file is written at start, the Deployment carries a
`checksum/config` pod annotation: editing the ConfigMap alone would otherwise
leave every running pod serving the old configuration with no visible sign.

## Image

`ghcr.io/eliteaai/elitea-web`, published by `.github/workflows/publish.yml`
(matrix entry `elitea-web`, build context `.`, dockerfile
`apps/elitea-web/Containerfile`). Issue #240 noted this image "is currently
never published" — that was true when the issue was filed and is no longer:
the publish matrix entry landed with issue #244. Pin `image.tag` to a release
in production; `latest` with `pullPolicy: IfNotPresent` lets a node keep
serving a stale cached layer.

## Not in this chart

Ingress / HTTPRoute and securityContext hardening — a separate issue owns
those platform-wide (#240 scope boundary). Without an ingress the SPA is only
reachable in-cluster.

## Install

```bash
helm install elitea-web deploy/helm/elitea-web -n elitea \
  --set image.tag=v1.2.3
```
