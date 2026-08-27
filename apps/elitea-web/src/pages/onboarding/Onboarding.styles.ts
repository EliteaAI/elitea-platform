/**
 * Static `sx` objects for `Onboarding.tsx`.
 *
 * Split out of the page for the §3.5 file-length budget, following the
 * `*.styles.ts` convention `features/chat-input`'s `UserInput.styles.ts` and
 * seven siblings already use. Only the theme-INDEPENDENT objects live here;
 * every callback that reads `theme.vars.palette.*` stays inline at its element,
 * where the token it reads is visible beside the thing it paints.
 */
export const styles = {
  backButton: {
    position: 'absolute' as const,
    top: '1rem',
    left: '1.5rem',
    zIndex: 10,
  },
  body: {
    width: '100%',
    maxWidth: '53.75rem',
    boxSizing: 'border-box' as const,
    height: '40rem',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: '2rem',
  },
  logo: {
    width: '6.1875rem',
    height: '1.25rem',
  },
  footer: {
    height: '2.875rem',
    width: '28.75rem',
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerHead: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressContainer: {
    width: '100%',
  },
  /** Stand-in for the old app's `pages/LoadingPage.jsx` — out of this unit's
   *  `pages/onboarding` scope, and the new app has no shared equivalent yet. */
  loadingContainer: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
