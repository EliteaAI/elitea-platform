/**
 * Ambient module declaration for the `?react` SVGR import convention (vite-plugin-svgr@5.2.0,
 * context7-verified: /gregberge/svgr — `svgr({ svgrOptions: { ref: true } })` in vite.config.ts).
 *
 * This intentionally overrides the package's own bundled `vite-plugin-svgr/client` typings
 * (which type the default export as a plain `React.FunctionComponent`, i.e. no `ref` prop)
 * because this app enables `svgrOptions.ref = true`: every generated component is wrapped in
 * `React.forwardRef`, forwarding a ref to the root `<svg>` element. Do NOT also add a
 * `/// <reference types="vite-plugin-svgr/client" />` anywhere — the two declarations would
 * conflict on the same `*.svg?react` module.
 */
declare module '*.svg?react' {
  import type { SvgIconComponent } from '@/shared/ui/icons/svg-icon.types';

  const ReactComponent: SvgIconComponent;
  export default ReactComponent;
}
