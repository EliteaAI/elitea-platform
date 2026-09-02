/**
 * The invocation id out of an accepted invoke, or a thrown Error with the
 * caller's message. Every facade answers an invoke with
 * `{ invocation_id }`; an acceptance without one is a run nothing can
 * follow, and both DeepWiki consumers refused it in their own words. The
 * words stay the consumer's — they are user-visible copy — and the check
 * is here once.
 */
export function invocationIdFrom(body: unknown, noIdMessage: string): string {
  const id = (body as { invocation_id?: unknown } | undefined)?.invocation_id;
  if (typeof id !== 'string' || id === '') {
    throw new Error(noIdMessage);
  }
  return id;
}
