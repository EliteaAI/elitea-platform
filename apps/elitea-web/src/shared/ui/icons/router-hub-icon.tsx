/**
 * Ported from apps/elitea-ui/src/assets/router-icon.svg (Wave-1 icon port, unit S2).
 * Name collision with router.svg resolved by content: this is the hub-and-spoke network-node glyph, renamed RouterHubIcon. Unreferenced by any consumer in the old app (grep: 0 hits) — ported anyway per no-placeholder rule.
 *
 * @public Wave-1 surface: consumed by later units as they build screens (S1 and others land the
 * call sites; this export exists ahead of its first consumer).
 */
export { default as RouterHubIcon } from './svg/router-hub-icon.svg?react';
