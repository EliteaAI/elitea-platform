import type { SxProps, Theme } from '@mui/material/styles';

/**
 * Merge any number of `sx` values (own styles plus a caller-supplied
 * override) into one array-form `sx` prop, flattening any that are
 * themselves arrays.
 *
 * The baseline leans on the `sx={[styles.a, ...(Array.isArray(sx) ? sx :
 * [sx])]}` idiom inline in nearly every component (`BasicAccordion.jsx`,
 * `StyledAccordion.jsx`, etc.). Repeating that ternary-and-spread inline is
 * exactly the shape tsgolint's type-aware pass cannot fully narrow (it
 * reports `no-unsafe-assignment`/`no-unsafe-call` on the spread), so it is
 * isolated once, here, instead of in every component file.
 */
export function combineSx(...items: ReadonlyArray<SxProps<Theme> | undefined>): SxProps<Theme> {
  const merged: SxProps<Theme>[] = [];
  for (const item of items) {
    if (item === undefined) continue;
    if (Array.isArray(item)) {
      for (const nested of item as SxProps<Theme>[]) {
        merged.push(nested);
      }
    } else {
      merged.push(item);
    }
  }
  // `SxProps<Theme>`'s array branch is `readonly (...)[]`; the concrete
  // return value IS exactly that shape, but the declared union type does not
  // distribute over `Array<SxProps<Theme>>` structurally, so one explicit,
  // reviewed cast replaces what would otherwise be an unsafe cast at every
  // call site.
  return merged as SxProps<Theme>;
}
