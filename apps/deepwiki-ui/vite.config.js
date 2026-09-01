import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The vendored DeepWiki SPA (ADR-0022 decision 8), served by elitea-main.
//
// THIS IS INTERIM. The target is a native elitea-web feature; this bundle
// exists so the port has a working UI before that rewrite, and it is expected
// to be deleted rather than maintained.
//
// Three things changed from the legacy config, and each one is a consequence
// of who serves the bundle now.
export default defineConfig({
  plugins: [react()],

  // ABSOLUTE, not './'. elitea-main serves this SPA from one prefix and
  // rewrites unknown paths to index.html, so a deep link like
  // /app/deepwiki/wikis/42 must still resolve its assets — and a relative base
  // resolves them against the deep path, where nothing is served.
  base: '/app/deepwiki/',

  build: {
    // INSIDE the app directory. The legacy config wrote to '../dist', which
    // put build output in the parent — fine when the parent was a plugin's
    // static/ directory, and wrong in a monorepo where the parent is apps/.
    outDir: 'dist',
    emptyOutDir: true,

    // No source maps. They were 19MB of the legacy dist, they ship the whole
    // source to every browser that loads the page, and nothing in this
    // deployment reads them.
    sourcemap: false,
  },

  // NO DEV PROXY. The legacy config proxied /api/v2 and /socket.io to
  // https://dev.elitea.ai with `secure: false` and optionally attached a
  // bearer token from the environment — a developer's local page talking to a
  // shared environment with TLS verification off. The bundle is served
  // same-origin by elitea-main now, so there is nothing to proxy: run the
  // platform and load the page from it.
  server: {
    port: 5174,
  },
})
