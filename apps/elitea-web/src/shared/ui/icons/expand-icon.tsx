/**
 * Ported from apps/elitea-ui/src/assets/expand-icon.svg (Wave-1 icon port, unit S2).
 * Deduplicated with the byte-identical assets/expand.svg (which had 0 consumers in the old app).
 *
 * @public Wave-1 surface: consumed by later units as they build screens (S1 and others land the
 * call sites; this export exists ahead of its first consumer).
 */
export { default as ExpandIcon } from './svg/expand-icon.svg?react';
