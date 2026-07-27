/**
 * Ported from apps/elitea-ui/src/assets/chroma-icon.svg (Wave-1 icon port, unit S2).
 * ChromaDB vendor/tool logo: 3-tone grey "atom" mark (#85939D/#A1B0BB/#515C65) that encodes depth via distinct tones. Forcing one currentColor flattens the layered look and stops it reading as the Chroma mark — kept verbatim.
 *
 * @public Wave-1 surface: consumed by later units as they build screens (S1 and others land the
 * call sites; this export exists ahead of its first consumer).
 */
export { default as ChromaIcon } from './svg/chroma-icon.svg?react';
