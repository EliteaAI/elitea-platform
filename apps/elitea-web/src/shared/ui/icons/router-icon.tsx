/**
 * Ported from apps/elitea-ui/src/assets/router.svg (Wave-1 icon port, unit S2).
 * BUGFIX: source had fill="curren Color" (typo, missing "t") which silently fell back to the SVG default fill (black) in every theme — fixed to fill="currentColor". Name collision with router-icon.svg resolved by content: this is the connector/plug glyph (1 consumer).
 *
 * @public Wave-1 surface: consumed by later units as they build screens (S1 and others land the
 * call sites; this export exists ahead of its first consumer).
 */
export { default as RouterIcon } from './svg/router-icon.svg?react';
