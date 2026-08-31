# `apps/deepwiki-ui` — the vendored DeepWiki SPA

**Interim, by declaration.** ADR-0022 decision 8: this bundle exists so the
port has a working UI before the native elitea-web feature is built, and it is
expected to be *deleted* rather than maintained. Served by elitea-main at
`/app/deepwiki/{project_id}` — see
`services/elitea-main/internal/api/v2/deepwikiui`.

## What was changed on the way in, and why

The vendored source is the legacy plugin's `static/ui/template`, with five
changes. Each one is a consequence of who serves the bundle now.

**It did not compile.** `src/utils/eliteaClient.js` declared
`updateClientAuthToken` and `updateClientConfig` twice each — a `SyntaxError`
in an ES module. The legacy repository shipped a built `dist/` beside it, so
the artefact and its source had drifted apart with nothing between them to
notice. The duplicates are gone and `.github/workflows/ci-deepwiki-ui.yml`
builds the bundle on every change.

**`X-SECRET` is gone.** ADR-0022 decision 6 retires the legacy shared-string
header: no surface of the ported service sends or honours it. The client was
one of those surfaces, and it had been sending the literal word `secret` to
something that ignored it. A `Bearer` header with an empty token went with it —
a malformed credential is worse than none, because some servers reject it
outright instead of treating the request as unauthenticated, and the session
cookie never gets its turn.

**`/slots` goes through the facade.** It used to be
`/app/ui_host/wikis/api/{project_id}` — the pylon `ui_host` plugin proxying
straight to the DeepWiki plugin. There is no `ui_host` in the Go platform and
no direct route to the provider: elitea-main is the only door, and the path is
now `/api/v2/deepwiki/slots/{project_id}`.

**The invocation channel is HTTP, not socket.io.** This is the largest change,
and it is contained to `src/hooks/useSocket.js`. The SPA started a generation
by emitting `test_toolkit_tool` on the platform's socket.io server and listened
for streamed progress; the Go platform serves no socket.io at all. That module
now keeps its entire exported interface — `useManualSocket`, `sioEvents`,
`SocketMessageType`, `emitSocketEvent` — and implements it over the facade:
`POST .../invoke`, then poll `GET .../invocations/...` and synthesise the same
message objects the components already parse. Two consumers read it, together
some 7,600 lines; rewriting their event handling would have been a large diff
whose correctness nobody could check by reading it.

`src/hooks/useSocket.test.js` covers the two functions that do the translating.

**`src/App.jsx` is deleted.** `main.jsx` renders `DeepWikiApp` directly, so
that file had no caller. It held the only remaining `socket.io-client` import,
which is why the dependency could go entirely.

## What does not work, and says so

**Automatic diagram repair** (ChatDrawer's "fix this broken mermaid diagram
with an LLM") was built on the platform's socket.io `application_predict`
stream. It now refuses immediately with a message naming what is missing.
Letting it run would POST, wait for events that never arrive, and time out
after ninety seconds — which a user reads as a slow server rather than as a
feature that is not wired.

## Working on it

```bash
cd apps/deepwiki-ui && npm ci && npm test && npm run build
```

There is no dev server proxy any more. The legacy config proxied `/api/v2` and
`/socket.io` to `https://dev.elitea.ai` with TLS verification off and an
optional bearer token from the environment. The bundle is served same-origin by
elitea-main now, so there is nothing to proxy: run the platform and load the
page from it.

`vite.config.js`'s `base` is `/app/deepwiki/` and it is compiled into every
asset URL. It must match `deepwikiui.BasePath`; a mismatch renders a page that
404s on its own JavaScript. Both sides are asserted — the Go handler in
`TestTheBasePathMatchesTheViteBase`, the artefact in the CI workflow.
