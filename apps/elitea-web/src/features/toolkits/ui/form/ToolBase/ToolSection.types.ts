/**
 * `ToolSection.tsx`'s two smallest shared types, in their own file so
 * `ToolSection.tsx` and `ToolSection.helpers.ts` can both import them
 * without an import cycle (R-L2, `no-circular`) — `ToolSection.tsx` imports
 * functions FROM `ToolSection.helpers.ts`, so `ToolSection.helpers.ts`
 * cannot import types back FROM `ToolSection.tsx`.
 */
export interface ToolSectionSubsection {
  readonly name: string;
  readonly fields?: readonly string[] | undefined;
}

/** §3.5 12-prop-budget grouping: presentation toggles. */
export interface ToolSectionVisibility {
  readonly showOnlyConfigurationFields?: boolean | undefined;
  readonly disableConfigFields?: boolean | undefined;
  readonly checkboxAsteriskRequired?: boolean | undefined;
}
