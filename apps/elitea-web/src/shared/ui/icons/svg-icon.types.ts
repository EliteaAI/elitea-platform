import type { ComponentProps, ForwardRefExoticComponent, RefAttributes } from 'react';

/**
 * Type of every generated icon component in this directory: a ref-forwarding
 * `<svg>` component (vite-plugin-svgr@5.2.0 with `svgrOptions.ref: true`,
 * see vite.config.ts and ./svg-react.d.ts).
 *
 * @public Wave-1 surface: the shared shape referenced by every per-icon file
 * and by consumers that want to type an "icon prop" generically.
 */
export type SvgIconComponent = ForwardRefExoticComponent<
  ComponentProps<'svg'> & {
    title?: string;
    titleId?: string;
    desc?: string;
    descId?: string;
  } & RefAttributes<SVGSVGElement>
>;
