import { buildEliteaTheme, resolveBrandPack } from '@/shared/brand';

/**
 * Standalone MUI theme for the maintenance entry point.
 *
 * Built from the same `buildEliteaTheme`/`resolveBrandPack` the main app's
 * `BrandThemeProvider` uses, so the maintenance splash renders with real
 * brand tokens instead of a hand-copied literal snapshot of them (the
 * `background.onboarding`/`background.welcome`/`icon.fill.magicAssistant`
 * etc. values this page needs already live in the shared pack — there is no
 * circular dependency here, since `shared/brand` never imports `app/` or
 * `entries/`). `main.tsx` passes `defaultMode="light"` to `ThemeProvider`
 * since this splash page has no mode toggle and always renders light,
 * unlike the main app's dark-default.
 */
/*
 * `resolveBrandPack()` reads the served pack (`window.elitea_brand`, set by
 * the bootstrap script maintenance.html loads) and falls back to
 * `DEFAULT_BRAND_PACK` when nothing was served or the pack failed validation
 * (ADR-0024 WP5). The splash therefore follows a rebrand exactly as the app
 * shell does, and looks as it always did when elitea-main is unreachable.
 */
export default buildEliteaTheme(resolveBrandPack());
