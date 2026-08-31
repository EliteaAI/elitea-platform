import { CSS_VAR_PREFIX } from '@/shared/brand';

/**
 * Mermaid theme variable name -> the brand token whose CSS custom property
 * supplies its value.
 *
 * Mermaid cannot be handed `theme.vars.palette.x` directly: those are
 * `var(--el-palette-…)` REFERENCES, and mermaid's `base` theme derives dozens
 * of further colours from these seeds by doing real colour maths on them
 * (khroma `darken`/`adjust`), which a `var(…)` string is not. So the values are
 * read RESOLVED, off the live element, at render time — which is also what
 * makes both schemes work from one code path: the same custom property resolves
 * to the light value under `[data-el-scheme="light"]` and the dark value under
 * `[data-el-scheme="dark"]`, with no branch on the scheme anywhere (R-T2 /
 * `elitea/no-mode-branch`).
 *
 * There are deliberately NO hardcoded fallback colours here: a fallback would
 * be a raw colour literal (`elitea/no-raw-color`, theme-gate check 1) and would
 * be wrong in one of the two schemes by construction. When a property does not
 * resolve, the key is omitted and mermaid's own `base` default stands in.
 */
const THEME_VARIABLE_TOKENS: Readonly<Record<string, string>> = {
  background: 'palette-background-default',
  mainBkg: 'palette-background-tabPanel',
  primaryColor: 'palette-background-tabPanel',
  primaryTextColor: 'palette-text-primary',
  primaryBorderColor: 'palette-border-lines',
  secondaryColor: 'palette-background-secondary',
  secondaryTextColor: 'palette-text-secondary',
  secondaryBorderColor: 'palette-border-lines',
  tertiaryColor: 'palette-background-default',
  tertiaryTextColor: 'palette-text-secondary',
  tertiaryBorderColor: 'palette-border-lines',
  lineColor: 'palette-border-lines',
  textColor: 'palette-text-primary',
  nodeBorder: 'palette-border-lines',
  clusterBkg: 'palette-background-default',
  clusterBorder: 'palette-border-lines',
  titleColor: 'palette-text-primary',
  edgeLabelBackground: 'palette-background-default',
  errorBkgColor: 'palette-background-errorBkg',
  errorTextColor: 'palette-text-error',
};

/** Mermaid's `themeVariables` bag, plus the font family it draws labels with. */
export interface MermaidThemeSettings {
  readonly themeVariables: Readonly<Record<string, string>>;
  readonly fontFamily: string | undefined;
}

/**
 * Resolves the diagram palette from the computed style of `element` — i.e. from
 * whatever scheme is active for the subtree the diagram actually lives in.
 *
 * Returns an empty bag when the environment has no usable computed style (jsdom
 * resolves few custom properties); mermaid then draws with its own `base`
 * defaults rather than throwing.
 */
export function readMermaidThemeSettings(element: Element): MermaidThemeSettings {
  const computed = globalThis.getComputedStyle(element);
  const themeVariables: Record<string, string> = {};

  for (const [variable, token] of Object.entries(THEME_VARIABLE_TOKENS)) {
    const value = computed.getPropertyValue(`--${CSS_VAR_PREFIX}-${token}`).trim();
    if (value !== '') themeVariables[variable] = value;
  }

  const fontFamily = computed.fontFamily.trim();
  return { themeVariables, fontFamily: fontFamily === '' ? undefined : fontFamily };
}
