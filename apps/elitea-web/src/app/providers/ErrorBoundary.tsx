import { Component, type ErrorInfo, type ReactNode } from 'react';

import { t } from '@/shared/i18n';

export interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

/**
 * The app-wide render-error boundary (spec §3.2 "composition root ONLY";
 * §9.3 unit R2 task 4).
 *
 * A real React error boundary has to be a class component:
 * `getDerivedStateFromError`/`componentDidCatch` have no hook equivalent as
 * of React 19.2.8 (verified against the installed `react` package — no
 * `use*` export offers this; the React docs' own error-boundary reference
 * implementation is a class for the same reason). This is not a stopgap
 * pending a library; it is what "no placeholder logic" means for this task.
 *
 * Placement note (see `AppProviders.tsx` for the full nesting rationale):
 * this boundary sits OUTSIDE `BrandThemeProvider`/`I18nProvider`, so its
 * fallback markup deliberately does not depend on either — no `sx`, no
 * `theme.vars.*` read, NO custom inline styling at all (plain semantic HTML
 * only), the same posture `shared/config/ui/MissingEnvPage.tsx` already
 * takes for the config-gate case (that file, R-T9's own reference point, is
 * exactly this bare — see its header). This is also why the fallback carries
 * no `style` prop: R-T9 bans raw-px spacing everywhere, including here, and
 * a themed `theme.spacing(n)` is unavailable by design at this exact spot —
 * the browser's default block/heading/button spacing is what a
 * theme-independent fallback gets. Calling `t()` here is still correct even
 * though `I18nProvider` is mounted further down the tree: S8's `t()` reads
 * the configured i18next singleton directly (`shared/i18n/t.ts`) and works
 * with or without the React context provider being an ancestor.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // §9.3 unit R2 task 4: "logging the error (console.error at minimum; a
    // real error-reporting hook is out of scope, don't fabricate one)".
    console.error('[app/providers] AppErrorBoundary caught a render error', error, errorInfo);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error !== null) {
      return (
        <main>
          <div role="alert">
            <h1>{t('app.errorBoundary.title', 'Something went wrong')}</h1>
            <p>
              {t(
                'app.errorBoundary.description',
                'An unexpected error occurred. Reloading the page usually fixes it.',
              )}
            </p>
          </div>
          <button type="button" onClick={this.handleReload}>
            {t('app.errorBoundary.reload', 'Reload')}
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
