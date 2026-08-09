# `e2e/visual/` — Playwright snapshot suite (`@visual`)

Run only on release tags (`ci-web.yml`'s `visual` job) and only inside
`mcr.microsoft.com/playwright:v1.62.0-noble`.

## The rule that makes this suite worth having

**Never generate or update a baseline outside the pinned container.** Font
rasterisation and subpixel rendering differ between the container and any
developer host, so a host-generated baseline diffs against CI output on day one
— for reasons that have nothing to do with the UI. Issue #61 calls this "the
main thing that will make this suite useless if skipped".

```bash
# from apps/elitea-web, with the stack already up (up && seed)
podman run --rm --network host -v "$PWD":/work -w /work \
  -e CI=1 -e E2E_REUSE_STACK=1 \
  mcr.microsoft.com/playwright:v1.62.0-noble \
  npx playwright test --grep @visual --update-snapshots
```

`E2E_REUSE_STACK=1` stops Playwright trying to start the stack from inside a
container that has no container runtime — see `playwright.config.ts`.

The image tag is asserted against `package.json`'s pinned `@playwright/test` by
`scripts/check-playwright-image-tag.mjs`, so the two cannot drift.

## What these specs are, and are NOT

They answer **"has our rendering changed since the last commit"**. Baselines are
PNGs Playwright generated from our own app.

They are **not** compared against `parity/screenshot-index.json`'s 63 production
JPEGs, and cannot be: those are lossy JPEG, captured at a different DPR against a
real tenant, and they show the **old** app. Pixel-diffing against them would fail
on every screen by design.

The production screenshots are the **human** reference — you look at them while
writing a spec, to decide whether what we render is right. The Figma export
(`~/Documents/elitea/`, 1132 frames) is the design-intent reference. Three
artefacts, three questions; see that export's README.

## Coverage is deliberately partial

`scripts/check-visual-coverage.mjs` reports how many of the index's shots have a
spec, and fails only if a shot marked `wiringStatus: wired` has none.

Only `wired` routes are covered. Writing specs for routes still marked `ready`,
`needs-route-state`, `blocked-codegen` or `hybrid-defect` would bake stub UI into
a baseline and make it the official reference — the exact trap #61 warns about
with the stale `elitea-web:e2e` image.

When a route becomes `wired`, add its spec in the same change.
