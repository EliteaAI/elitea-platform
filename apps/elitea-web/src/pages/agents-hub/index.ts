/**
 * Agents Hub — public API for the agents-hub cluster.
 *
 * Per the A13 Amendment, agents-hub lives in `pages/` (not `features/`) to
 * avoid features-to-features import violations.
 */
export { default as AgentHub } from './AgentHub';
export type { AgentHubProps } from './AgentHub';
