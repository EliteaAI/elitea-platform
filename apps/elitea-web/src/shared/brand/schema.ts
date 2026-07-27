import { z } from 'zod';

/**
 * Tier 0 — the brand pack (spec §4.2). Reproduced VERBATIM from the spec;
 * no field was added, removed, widened or made optional.
 *
 * Contract notes that other units depend on (all verified against
 * zod@4.4.3 and mirrored field-for-field by the Go implementation in
 * `services/elitea-main/internal/api/v2/branding/pack.go`, unit W3):
 *
 *  - `.strict()` applies to the TOP LEVEL only. Nested objects keep zod's
 *    default "strip" mode, so an unknown nested key is dropped, not rejected.
 *  - `.optional()` means ABSENT, never `null`; no field in the schema is
 *    nullable.
 *  - `.default()` values are materialised on parse, so a parsed pack always
 *    carries `typography.baseSize`, `typography.scale`, `locale.default` and
 *    `locale.dateLocale` explicitly.
 *  - `schemes.light` / `schemes.dark` are OPEN records: token id -> colour.
 *    The id vocabulary is not part of the schema — it is the default pack's
 *    key set (`tokens/default.pack.json`), which is also the reference
 *    geometry `toMuiPalette` derives from. A pack may therefore ship a
 *    subset (or `{}`) and let `brand.hue` drive the rest.
 *
 * The derivation added by this unit needs NO extra schema field: `brand.hue`
 * is the only input it takes beyond the records themselves.
 */
export const BrandPack = z
  .object({
    $schema: z.literal('https://elitea.ai/schemas/brand-pack/1.json'),
    id: z.string().min(1), // 'default' | tenant slug
    version: z.string(), // semver of the pack itself
    product: z.object({
      name: z.string(), // 'Elitea'
      shortName: z.string(),
      tagline: z.string().optional(),
      // §4.2 writes `z.string().url()`. Zod 4 moved string formats to
      // top-level functions and deprecated the method form; `z.url()` is the
      // same schema (output `string`, same URL check), and the deprecated
      // spelling fails the D2 lint gate. Semantics are unchanged, so unit W3's
      // Go mirror (`optionalURL`) stays valid. Recorded as a §4.2 erratum.
      docsUrl: z.url().optional(),
      supportUrl: z.url().optional(),
    }),
    assets: z.object({
      logoFull: z.string(), // data: URI or same-origin path
      logoMark: z.string(),
      favicon: z.string(),
      loginArt: z.string().optional(),
    }),
    typography: z.object({
      fontFamily: z.string(), // must resolve to a self-hosted @font-face
      fontFamilyMono: z.string(),
      baseSize: z.number().min(12).max(18).default(14),
      scale: z.number().min(1.05).max(1.5).default(1.2),
    }),
    shape: z.object({
      radiusSm: z.number(),
      radiusMd: z.number(),
      radiusLg: z.number(),
      density: z.enum(['comfortable', 'compact']),
    }),
    locale: z.object({
      default: z.string().default('en-GB'),
      dateLocale: z.string().default('en-GB'),
    }),
    // brand hue is scheme-INDEPENDENT: one hue, two lightness ramps derived from it
    brand: z.object({ hue: z.string(), onBrand: z.string().optional() }),
    schemes: z.object({
      light: z.record(z.string(), z.string()), // token id -> colour
      dark: z.record(z.string(), z.string()),
      hc: z.record(z.string(), z.string()).optional(),
    }),
  })
  .strict();

export type BrandPack = z.infer<typeof BrandPack>;

/** One scheme's token record: token id -> colour (or any CSS colour-bearing value). */
export type SchemeRecord = BrandPack['schemes']['light'];

/** The scheme-independent brand input `toMuiPalette` derives ramps from. */
export type BrandInput = BrandPack['brand'];
