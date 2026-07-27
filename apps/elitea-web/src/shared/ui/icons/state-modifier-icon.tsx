/**
 * Ported from apps/elitea-ui/src/assets/state_modifier.svg (Wave-1 icon port, unit S2).
 * BUGFIX: source had fill="curren Color" (typo, missing "t") on the visible path, silently falling back to the SVG default fill (black) in every theme — fixed to fill="currentColor".
 *
 * @public Wave-1 surface: consumed by later units as they build screens (S1 and others land the
 * call sites; this export exists ahead of its first consumer).
 */
export { default as StateModifierIcon } from './svg/state-modifier-icon.svg?react';
