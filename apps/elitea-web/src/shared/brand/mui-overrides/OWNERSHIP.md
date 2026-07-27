# `mui-overrides/` — key ownership (R-T12)

MUI `styleOverrides` and `variants` exist **only** in this directory, one file per
`Mui*` key, each read exclusively through `theme.vars.*`. Theme-gate check 4
(`no MUI internal selectors outside the override package`) and the
`elitea/no-mui-internal-selector` override in `.oxlintrc.json` are scoped to this
path and nowhere else.

Unit **T1** established the structure and wired the two keys its contract test
needs. Unit **S1** (`src/shared/ui/**`, Wave 1) owns the rest: it ports the
baseline's component surface and must add one file per key here, plus a Storybook
story per file (R-T12).

The baseline's canonical `components` map is `apps/elitea-ui/src/MainTheme.js:118-364`
— **30 keys** (unit T2 §3 confirmed the count and corrected the spec's line range).

## Wired (unit T1)

| Key | File | Scope |
|---|---|---|
| `MuiButton` | `MuiButton.ts` | Token wiring for the six variants that carried the §4.1 Blocker-1 hard-coded accents (`special`, `contained`, `secondary`, `iconCounter`, `auxiliary`, `maxi`). Colour only — geometry is S1's. |
| `MuiChip` | `MuiChip.ts` | Canonical `root` + `outlined` slots, complete. Admin-ui's scheme-branching variant is deliberately NOT ported (T2 §3, class (b)). |

## Owned by unit S1 — 28 keys

`MuiToggleButton`, `MuiTextField`, `MuiInput`, `MuiIconButton`, `MuiDataGrid`,
`MuiDialog`, `MuiTreeItem`, `MuiMenuList`, `MuiMenuItem`, `MuiFormControl`,
`MuiFormHelperText`, `MuiCssBaseline`, `MuiAvatar`, `MuiPaper`, `MuiSelect`,
`MuiMenu`, `MuiTablePagination`, `MuiTab`, `MuiTabs`, `MuiAlert`, `MuiRadio`,
`MuiCheckbox`, `MuiSwitch`, `MuiDrawer`, `MuiAppBar`, `MuiBadge`, `MuiTooltip`,
`MuiAutocomplete`.

No stub files are committed for these: an empty override is indistinguishable from
a forgotten one, and `muiOverrides()` composing only real files keeps the wired set
greppable. The contract test asserts every key `muiOverrides()` returns has a render
surface in `__tests__/surfaces.tsx`, so adding a key here without widening the
hostile-pack sweep fails §4.6 check 7.

## Notes S1 needs before starting

1. **`MuiAlert` must be re-authored, not ported.** The baseline uses the CSS named
   colours `'green'`, `'red'`, `'orange'` for `filledSuccess`/`filledError`/
   `filledWarning` in *both* elitea-ui and admin-ui (T2 §3 calls it a shared defect).
   The tokens that replace them now exist: `palette.error.*`, `palette.success.*`
   (added by T1 per §4.2) and `palette.warning.*` (already in the baseline).
   `filledInfo` already uses `darkBlue` → `palette.info.main`.

2. **R-T10 has no escape hatch for non-token radii, and buttons need one.**
   `elitea/ad-hoc-radius` rejects every literal `borderRadius` value that is not
   `var(--el-radius-…)`; member expressions (`theme.vars.shape.radiusMd`) pass. The
   baseline's icon-only button and `maxi` FAB use `borderRadius: '50%'`, which is a
   *shape*, not a radius token, and has no member-expression form. T1 left the
   geometry out rather than weaken the rule or fake a token. S1 must either
   (a) get F2 to allow the `'50%'` / `'9999px'` pill idiom explicitly, or
   (b) add a `shape.radiusPill` token and use `theme.vars.shape.radiusPill`.
   Note that the rule's allow-pattern (`var(--el-radius-*)`) does not match the
   variables MUI actually emits (`--el-shape-radiusSm`), so the literal escape is
   unusable as written — another reason to prefer (b).

3. **Sizes come from typography variants.** `theme.typography.labelSmall` (and the
   nine siblings) are declared in `src/shared/brand/theme.augment.d.ts` and built by
   `typography.ts`. `labelLarge` does not exist — it was dead in the baseline (T2 §3).
