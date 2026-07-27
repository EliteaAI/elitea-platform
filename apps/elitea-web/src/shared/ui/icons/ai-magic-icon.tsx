/**
 * Ported (merged) from apps/elitea-ui/src/assets/{ai-magic-icon-dark.svg + ai-magic-icon-light.svg} (Wave-1 icon port, unit S2).
 * Merged from ai-magic-icon-{light,dark}.svg (spec §3.7 example pair). Path geometry is byte-identical between variants (verified: diff after normalizing the gradient id); they differed only by a 2-stop linearGradient (teal→magenta dark / magenta→blue light). Merged to a single flat fill="currentColor", dropping the gradient — matches R-T8.
 *
 * @public Wave-1 surface: consumed by later units as they build screens (S1 and others land the
 * call sites; this export exists ahead of its first consumer).
 */
export { default as AiMagicIcon } from './svg/ai-magic-icon.svg?react';
