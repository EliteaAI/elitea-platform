# The `brand-pack/1` frame envelope

Status: specified, not implemented (ADR-0024 WP8, deliverable D).

## Why this document exists

ADR-0024 decision 8 makes every sub-application screen (Wikis, Inventory) a
native `elitea-web` screen inside the brand provider. No screen runs in a
frame today, so no screen needs this envelope today.

ADR-0013 allows a future provider to ship its own UI in a frame. Such a frame
cannot read the host's theme, and it must not learn it from its URL. The
baseline app did exactly that (`/ui_host/{provider}/{route}/{project}/?theme=…&toolkit_id=…`).
WP8 removed that path from `pages/apps/AppDetail.tsx`. This document states
the contract that replaces it, so the first provider frame is built against a
written rule and not against the deleted code.

## The message

The host posts one message to the frame on load, and one more on every change
to the pack or the colour scheme.

```ts
interface BrandPackEnvelope {
  type: 'elitea.brand-pack';
  version: 1;
  pack: BrandPack;                 // the RESOLVED pack, after resolveBrandPack()
  colorScheme: 'light' | 'dark';   // the host's current scheme
}
```

- `type` is the discriminator. A receiver ignores any other `type`.
- `version` is `1`. A receiver rejects any other value. A breaking change to
  the shape increments it; an additive change does not.
- `pack` is the object `resolveBrandPack()` returned in the host. It is
  already validated and it already carries every `.default()` value. It is
  the same object the host built its own theme from.
- `colorScheme` is the host's active scheme. The pack carries both scheme
  records; this field says which one is in force.

## The transport rules

1. **Exact target origin, never `*`.** The host calls
   `frame.contentWindow.postMessage(envelope, frameOrigin)` with the origin it
   loaded the frame from. A `*` target leaks the pack to any document that
   navigated the frame.
2. **The receiver checks `event.origin`** against the host origin it was
   embedded by, and drops any message from another origin. It checks
   `event.source === window.parent` as well.
3. **The receiver validates `pack` with the same zod schema** the host uses
   (`src/shared/brand/schema.ts`, `BrandPack`). The schema is versioned with
   the envelope. A pack that fails validation is dropped, and the frame keeps
   its previous pack (or the compiled default on first load).
4. **No context in the frame URL.** The frame URL carries the route and
   nothing else. Theme, scheme, project, toolkit and every other piece of
   host context arrive by message. This is the ADR-0013 rule that the
   baseline's `?theme=…&toolkit_id=…` broke.
5. **The frame asks, the host answers.** On load, the frame posts
   `{ type: 'elitea.brand-pack.request', version: 1 }` to `window.parent`
   with the host origin as target. The host answers with the envelope. This
   removes the race between frame load and the host's first post.
6. **Sandbox.** The host frame sets `sandbox="allow-scripts allow-forms"`.
   It never sets `allow-same-origin` together with `allow-scripts`; that pair
   lets the frame remove its own sandbox attribute.

## Sequence

```
host                                  frame
 |  load <iframe src=route>             |
 |------------------------------------->|
 |            brand-pack.request        |
 |<-------------------------------------|
 |  elitea.brand-pack v1 (pack, scheme) |
 |------------------------------------->|  validate(pack) -> apply theme
 |                                      |
 |  user toggles scheme                 |
 |  elitea.brand-pack v1 (pack, scheme) |
 |------------------------------------->|  validate(pack) -> apply theme
```

## What the receiver may derive

The receiver builds its own theme from `pack` with the same derivation the
host uses (`toMuiPalette`, `buildEliteaTheme`) when it is a React/MUI app, or
from the scheme records directly when it is not. It reads
`pack.product.name`, `pack.product.docsUrl`, `pack.product.supportUrl` and
`pack.product.supportEmail` for its own copy and links. It does not fetch
`/api/v2/branding/bootstrap.js` itself; the host is the single source.

## Not in scope

- Any frame in `elitea-web` today. This is a specification only.
- Authentication or session hand-off to the frame. ADR-0013 covers that
  separately; the envelope carries no credential and no identifier.
