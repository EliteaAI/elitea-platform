/**
 * Ported from apps/elitea-ui/src/assets/clock.svg (Wave-1 icon port, unit S2).
 * Name collision with clock_icon.svg resolved by content: ring + right-angle hand glyph (4 consumers in the old app, the more common "ClockIcon" alias).
 *
 * @public Wave-1 surface: consumed by later units as they build screens (S1 and others land the
 * call sites; this export exists ahead of its first consumer).
 */
export { default as ClockIcon } from './svg/clock-icon.svg?react';
