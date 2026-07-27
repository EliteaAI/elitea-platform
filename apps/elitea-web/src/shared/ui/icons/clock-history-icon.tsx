/**
 * Ported from apps/elitea-ui/src/assets/clock_icon.svg (Wave-1 icon port, unit S2).
 * Name collision with clock.svg resolved by content: ring + diagonal hand glyph, renamed ClockHistoryIcon based on its consumers (ViewRunHistoryButton, RunStateNodeGroup). Deduplicated with the byte-identical assets/icons/clock_icon.svg.
 *
 * @public Wave-1 surface: consumed by later units as they build screens (S1 and others land the
 * call sites; this export exists ahead of its first consumer).
 */
export { default as ClockHistoryIcon } from './svg/clock-history-icon.svg?react';
