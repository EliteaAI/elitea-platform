/**
 * Hand-written module augmentation for the non-palette half of the theme
 * (the palette half is GENERATED into `tokens/palette.augment.d.ts`).
 *
 * Everything here exists because MUI's option interfaces are closed: without
 * the declaration the corresponding `createTheme` field is an excess-property
 * error, and the read site (`theme.typography.labelSmall`,
 * `theme.vars.shape.radiusMd`) has no type.
 */
import '@mui/material/styles';
import '@mui/material/Button';
import '@mui/material/Typography';

declare module '@mui/material/styles' {
  /**
   * The switch that makes `Theme` the CSS-VARIABLE theme type app-wide
   * (`createThemeNoVars.d.ts`: `CssThemeVariables extends { enabled: true }`
   * promotes `vars`, `colorSchemes`, `cssVarPrefix`, `generateStyleSheets` &
   * co. from optional to required). Without it every `theme.vars.…` read
   * needs a non-null assertion, and `ReturnType<typeof buildEliteaTheme>`
   * silently degrades to the no-vars `Theme`.
   *
   * It is correct app-wide because there is exactly one theme and
   * `cssVariables` is always on (buildTheme.ts).
   */
  interface CssThemeVariables {
    enabled: true;
  }

  /** The ten live variants of MainTheme.js:17-89 (labelLarge excluded, T2 §3). */
  interface TypographyVariants {
    headingLarge: React.CSSProperties;
    headingMedium: React.CSSProperties;
    headingSmall: React.CSSProperties;
    labelMedium: React.CSSProperties;
    labelSmall: React.CSSProperties;
    labelTiny: React.CSSProperties;
    bodyMedium: React.CSSProperties;
    bodySmall: React.CSSProperties;
    bodySmall2: React.CSSProperties;
    subtitle: React.CSSProperties;
    /** Pack field `typography.fontFamilyMono`; MUI has no built-in slot. */
    fontFamilyMono: string;
  }

  interface TypographyVariantsOptions {
    headingLarge?: React.CSSProperties;
    headingMedium?: React.CSSProperties;
    headingSmall?: React.CSSProperties;
    labelMedium?: React.CSSProperties;
    labelSmall?: React.CSSProperties;
    labelTiny?: React.CSSProperties;
    bodyMedium?: React.CSSProperties;
    bodySmall?: React.CSSProperties;
    bodySmall2?: React.CSSProperties;
    subtitle?: React.CSSProperties;
    fontFamilyMono?: string;
  }

  /** `shape.radius*` — the only radii R-T10 allows (see buildTheme.ts). */
  interface ShapeOptions {
    radiusSm?: number;
    radiusMd?: number;
    radiusLg?: number;
  }

  /** MainTheme.js:92-111 — ten prompt-list rungs plus `tablet`. */
  interface BreakpointOverrides {
    prompt_list_xs: true;
    prompt_list_sm: true;
    prompt_list_full_width_sm: true;
    prompt_list_md: true;
    prompt_list_lg: true;
    prompt_list_xl: true;
    prompt_list_xxl: true;
    prompt_list_xxxl: true;
    prompt_list_xxxxl: true;
    prompt_list_xxxxxl: true;
    tablet: true;
  }
}

declare module '@mui/material/Button' {
  /**
   * The baseline's button variant vocabulary (`BaseBtn.jsx:12-27`). T1 wires
   * the six that carried the §4.1 Blocker-1 hard-coded accents; the names are
   * declared in full so unit S1 adds styles, not types.
   */
  interface ButtonPropsVariantOverrides {
    elitea: true;
    secondary: true;
    special: true;
    alarm: true;
    auxiliary: true;
    icon: true;
    iconCounter: true;
    maxi: true;
    iconLabel: true;
    tertiary: true;
    neutral: true;
    positive: true;
  }
}

declare module '@mui/material/Typography' {
  /** `<Typography variant="labelSmall">` — the ten variants declared above. */
  interface TypographyPropsVariantOverrides {
    headingLarge: true;
    headingMedium: true;
    headingSmall: true;
    labelMedium: true;
    labelSmall: true;
    labelTiny: true;
    bodyMedium: true;
    bodySmall: true;
    bodySmall2: true;
    subtitle: true;
  }
}
