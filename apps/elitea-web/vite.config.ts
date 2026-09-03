import { URL, fileURLToPath } from 'node:url';

import babel from '@rolldown/plugin-babel';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig, type PluginOption, type UserConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import svgr from 'vite-plugin-svgr';
import tsconfigPaths from 'vite-tsconfig-paths';

const resolvePath = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * Three build targets (spec §7.4), selected via `vite build --mode <target>`:
 *
 *  - (default)      main SPA        base './' (contract C4), outDir dist/app
 *  - admin          admin module    base '/admin/app/' so the Go adminui handler's
 *                                   marker substitution and asset serving keep
 *                                   working unchanged (contract C15), dist/admin
 *  - maintenance    self-contained  vite-plugin-singlefile inlines everything into
 *                                   one maintenance.html, dist/maintenance
 *  - brand-preview  self-contained  the offline brand previewer (ADR-0024 WP9),
 *                                   one index.html, dist/brand-preview
 *
 * Vite keeps NODE_ENV=production for `vite build` regardless of a custom --mode
 * (mode and NODE_ENV are distinct), so all three outputs are production builds.
 *
 * The TanStack Router plugin (unit R1, §2.3/§9.3): file-based routing over
 * `src/routes/**`, `autoCodeSplitting: true`. Main-app target ONLY — admin
 * and maintenance are plain single-entry SPAs with no route tree.
 * `routeFileIgnorePattern` excludes `-`-prefixed helper directories
 * (`-search/`, `-guards/`, `-ui/`) by TanStack's own default convention
 * (`routeFileIgnorePrefix` defaults to `"-"`, verified against the
 * installed `@tanstack/router-generator@1.168.23` — no override needed) and
 * `__tests__/`, which is NOT excluded by default and must be listed
 * explicitly.
 *
 * `splitBehavior` keeps `/auth-callback` OUT of the split (`[]` = no lazy
 * chunk for that route, matching old `router.jsx:4`'s eager, non-lazy
 * import of `AuthCallbackPage` — every other page in the old app is
 * `ChunkHelpers.lazyWithRetry`-wrapped, this one deliberately is not).
 */
export default defineConfig(({ mode }): UserConfig => {
  const basePlugins: PluginOption[] = [
    react(),
    // React Compiler (spec §2.1): plugin-react 6 removed its `babel` option, so
    // the compiler is wired via @rolldown/plugin-babel + reactCompilerPreset().
    babel({ presets: [reactCompilerPreset()] }),
    // svgrOptions.ref (unit S2, §3.7/R-T8): every icon in shared/ui/icons/** is imported via
    // the `?react` convention and typed as a ref-forwarding component (see
    // shared/ui/icons/svg-react.d.ts, which overrides the package's default,
    // non-ref-forwarding `vite-plugin-svgr/client` typings to match).
    svgr({ svgrOptions: { ref: true } }),
    tsconfigPaths({ projects: [resolvePath('./tsconfig.json')] }),
  ];

  if (mode === 'admin') {
    return {
      plugins: basePlugins,
      root: resolvePath('./src/entries/admin'),
      base: '/admin/app/',
      // Copied verbatim into dist/admin. Holds `assets/scheme-init.js` and
      // `assets/favicon.svg` (ADR-0024 WP3): the Go adminui handler serves
      // exactly one directory from disk, `/admin/app/assets/*`, and its CSP
      // admits no second inline script, so the first-paint scheme script
      // has to be a same-origin FILE under that directory.
      publicDir: resolvePath('./src/entries/admin/public'),
      build: {
        outDir: resolvePath('./dist/admin'),
        emptyOutDir: true,
        sourcemap: false,
      },
    };
  }

  if (mode === 'maintenance') {
    return {
      plugins: [...basePlugins, viteSingleFile()],
      root: resolvePath('./src/entries/maintenance'),
      base: './',
      publicDir: false,
      build: {
        outDir: resolvePath('./dist/maintenance'),
        emptyOutDir: true,
        sourcemap: false,
        rollupOptions: {
          input: resolvePath('./src/entries/maintenance/maintenance.html'),
        },
      },
    };
  }

  if (mode === 'brand-preview') {
    // ADR-0024 WP9: the offline brand previewer a branding package ships as
    // `preview/app.html`. Same shape as the maintenance entry — one HTML
    // file with every script and style inlined — and, unlike it, with NO
    // request of its own: a designer opens it from `file://` with no Elitea
    // running, and the Go exporter fills the inline `#brand-pack` element.
    return {
      plugins: [...basePlugins, viteSingleFile()],
      root: resolvePath('./src/entries/brand-preview'),
      base: './',
      publicDir: false,
      build: {
        outDir: resolvePath('./dist/brand-preview'),
        emptyOutDir: true,
        sourcemap: false,
        rollupOptions: {
          input: resolvePath('./src/entries/brand-preview/index.html'),
        },
      },
    };
  }

  return {
    plugins: [
      // Must run before @vitejs/plugin-react (react()): it rewrites route
      // files' exports (autoCodeSplitting) before JSX/compiler transforms
      // see them. Verified via the installed package's own vite.js plugin
      // ordering example.
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: resolvePath('./src/routes'),
        generatedRouteTree: resolvePath('./src/routeTree.gen.ts'),
        // Matches `__tests__/` directories AND colocated `*.test.tsx`
        // files (e.g. `routes/auth-callback.test.tsx`) — both patterns
        // appear under src/routes/**; without the second alternative the
        // generator warns "does not export a Route" for every colocated
        // test file (harmless — they're excluded from the tree either
        // way — but noisy, and worth silencing at the source).
        routeFileIgnorePattern: '(__tests__|\\.test\\.tsx?$)',
        codeSplittingOptions: {
          splitBehavior: ({ routeId }) => (routeId === '/auth-callback' ? [] : undefined),
        },
      }),
      ...basePlugins,
    ],
    base: './', // contract C4: assets emitted with relative URLs
    build: {
      outDir: resolvePath('./dist/app'),
      emptyOutDir: true,
      sourcemap: false,
    },
    server: devServerProxy(),
  };
});

/**
 * `npm run dev` against a real backend, with HMR.
 *
 * The SPA is normally served BY elitea-main, so it has no API of its own to
 * talk to in dev. This forwards every server-owned path to a running stack —
 * by default the standalone one (`deploy/scripts/standalone-stack.sh up`) at
 * :8084 — so `npm run dev` gives hot reload against real data instead of a
 * blank screen.
 *
 * Point it elsewhere with `ELITEA_DEV_BACKEND=http://host:port npm run dev`.
 *
 * The four proxied prefixes are not arbitrary:
 *
 *  - `/api/v2`      the whole REST surface, AND `branding/bootstrap.js`, which
 *                   `index.html` loads with a ROOT-ABSOLUTE src. Without this
 *                   the brand pack 404s and the app silently falls back to the
 *                   compiled-in default (channel A) — it would look almost
 *                   right, which is worse than looking broken.
 *  - `config.js`    at ANY depth — `index.html` asks for it RELATIVE, so a
 *                   deep link resolves it against that path. The stack serves
 *                   the same file at `/app/config.js`, hence the rewrite. It
 *                   carries `vite_server_url`, `vite_public_project_id` and
 *                   the socket settings; with it missing the app boots with an
 *                   undefined config rather than an error.
 *  - `/forward-auth`, `/auth`  the sign-in redirect chain.
 *  - `/socket.io`   upgraded, not just forwarded (`ws: true`).
 *
 * Cookies work across the port change because a cookie's origin is its DOMAIN,
 * not its port: a session minted at localhost:8084 is sent to localhost:5173
 * too. That is why this needs no cookie rewriting and why signing in on either
 * port signs you in on both.
 */
function devServerProxy(): NonNullable<UserConfig['server']> {
  const target = process.env['ELITEA_DEV_BACKEND'] ?? 'http://localhost:8084';
  const forward = { target, changeOrigin: true } as const;
  return {
    proxy: {
      '/api/v2': forward,
      '/llm': forward,
      '/forward-auth': forward,
      '/auth': forward,
      '/socket.io': { ...forward, ws: true },
      // A REGEX, matching `config.js` at ANY depth. `index.html` loads it as
      // `./config.js`, so the browser resolves it against the current path:
      // `/settings/personalization` asks for `/settings/config.js`, not
      // `/config.js`. In production nginx absorbs that with a depth-tolerant
      // alias (contract C8); a literal `/config.js` key here works on the root
      // route and then hands every deep link a 404 that surfaces as the
      // "System env missing: VITE_SERVER_URL …" page.
      '^/.*/?config\\.js$': { ...forward, rewrite: () => '/app/config.js' },
    },
  };
}
