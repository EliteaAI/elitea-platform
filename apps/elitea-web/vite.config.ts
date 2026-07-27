import { URL, fileURLToPath } from 'node:url';

import babel from '@rolldown/plugin-babel';
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
 *
 * Vite keeps NODE_ENV=production for `vite build` regardless of a custom --mode
 * (mode and NODE_ENV are distinct), so all three outputs are production builds.
 *
 * The TanStack Router plugin (file-based routes, autoCodeSplitting) is wired by
 * unit R1 together with the route tree; the scaffold has no routes to generate.
 */
export default defineConfig(({ mode }): UserConfig => {
  const basePlugins: PluginOption[] = [
    react(),
    // React Compiler (spec §2.1): plugin-react 6 removed its `babel` option, so
    // the compiler is wired via @rolldown/plugin-babel + reactCompilerPreset().
    babel({ presets: [reactCompilerPreset()] }),
    svgr(),
    tsconfigPaths({ projects: [resolvePath('./tsconfig.json')] }),
  ];

  if (mode === 'admin') {
    return {
      plugins: basePlugins,
      root: resolvePath('./src/entries/admin'),
      base: '/admin/app/',
      publicDir: false,
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

  return {
    plugins: basePlugins,
    base: './', // contract C4: assets emitted with relative URLs
    build: {
      outDir: resolvePath('./dist/app'),
      emptyOutDir: true,
      sourcemap: false,
    },
  };
});
