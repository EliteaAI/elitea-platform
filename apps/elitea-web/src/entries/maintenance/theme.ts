import { DEFAULT_BRAND_PACK, buildEliteaTheme } from '@/shared/brand';

/**
 * Standalone MUI theme for the maintenance entry point.
 *
 * Built from the same `buildEliteaTheme`/`DEFAULT_BRAND_PACK` the main app's
 * `BrandThemeProvider` uses, so the maintenance splash renders with real
 * brand tokens instead of a hand-copied literal snapshot of them (the
 * `background.onboarding`/`background.welcome`/`icon.fill.magicAssistant`
 * etc. values this page needs already live in the shared pack — there is no
 * circular dependency here, since `shared/brand` never imports `app/` or
 * `entries/`). `main.tsx` passes `defaultMode="light"` to `ThemeProvider`
 * since this splash page has no mode toggle and always renders light,
 * unlike the main app's dark-default.
 */
export default buildEliteaTheme(DEFAULT_BRAND_PACK);
