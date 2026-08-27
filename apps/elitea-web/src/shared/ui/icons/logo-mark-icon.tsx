/**
 * The Elitea brand MARK — the gradient orb, `viewBox="0 0 36 34"`.
 *
 * Distinct from `LogoIcon`, which is the full WORDMARK (`0 0 99 20`, the orb
 * plus the "ELITEA" lettering). The two are not interchangeable: rendering
 * the wordmark inside a square box — which `SidebarHeader` did — squeezes
 * 99 units of artwork into ~28px and the lettering collapses into an
 * illegible smudge. Production shows the mark there, not the wordmark.
 *
 * Multi-colour by design (four gradients, teal/magenta/orange stops), like
 * `LogoIcon` — a brand asset, not a themeable UI icon, so it is kept verbatim
 * and never recoloured by `currentColor`.
 *
 * @public
 */
export { default as LogoMarkIcon } from './svg/logo-mark-icon.svg?react';
