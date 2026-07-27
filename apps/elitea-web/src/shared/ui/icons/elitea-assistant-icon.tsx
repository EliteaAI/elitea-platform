/**
 * Ported from apps/elitea-ui/src/assets/icons/elitea-assistant-icon.svg (Wave-1 icon port, unit S2).
 * BUGFIX: source path had no fill attribute at all (SVG default fill is black, not theme-adaptive) — added fill="currentColor".
 *
 * @public Wave-1 surface: consumed by later units as they build screens (S1 and others land the
 * call sites; this export exists ahead of its first consumer).
 */
export { default as EliteaAssistantIcon } from './svg/elitea-assistant-icon.svg?react';
