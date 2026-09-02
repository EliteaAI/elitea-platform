/**
 * `entities/provider-run` — the one provider-backed run (ADR-0023 decision 4).
 *
 * Every sub-application behind a facade runs the same way: an invoke that
 * answers an invocation id, a poll loop over read-once events, a terminal
 * poll, an optional cancel, and — for a run that must survive a reload — a
 * persisted id with a TTL. DeepWiki's generation and chat features each
 * carried a copy of that; they now consume this slice and keep only what is
 * theirs (how events become frames, how a result is read, their state).
 *
 * It is an ENTITY, not the `features/provider-run` the ADR names: the
 * dependency fence `no-sideways-features` forbids a feature importing a
 * feature, and the two consumers are features. The name is kept in the
 * slice; the layer follows the fence.
 *
 * Curated public API (§3.3): every symbol here has a consumer. The poll
 * loop takes callbacks and returns nothing on purpose — the state it feeds
 * is the consumer's, so the read-once hazard of a second loop over the same
 * invocation is not something a caller can wire by accident.
 */
export { invocationIdFrom } from './model/invocationId';
export { drainEventMessages, isTerminalPoll, terminalOutcome, type InvocationPoll } from './model/poll';
export { createRunStorage, type RunStorage } from './model/runStorage';
export { DEFAULT_POLL_INTERVAL_MS, useInvocationPoll } from './model/useInvocationPoll';
