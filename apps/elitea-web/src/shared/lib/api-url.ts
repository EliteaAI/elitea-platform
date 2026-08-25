/**
 * Turns the configured API URL into something a caller outside the browser can
 * use.
 *
 * WHY THIS EXISTS. `vite_server_url` is allowed to be a path rather than an
 * origin, and the shipped default IS a path: `docker-entrypoint.sh` writes
 * `vite_server_url: "/api/v2"` whenever one gateway fronts both the SPA and
 * elitea-main. Inside the page that is correct — every request is same-origin.
 *
 * The Settings screens then showed those values as copy-to-clipboard fields and
 * pasted them into generated SDK snippets. A live deployment displayed
 * `OpenAI-BaseURL: /llm/v1` and `Server URL: /api/v2` beside a copy button.
 * Copied into an OpenAI client, a curl command or a CI variable, a bare path
 * addresses nothing: the user has to know to prepend the host themselves.
 *
 * A value that already carries a scheme is returned untouched, so a deployment
 * that sets an absolute `VITE_SERVER_URL` keeps exactly what its operator
 * configured, including a different host from the one the page was served from.
 */
export function toAbsoluteApiUrl(value: string, origin: string = globalThis.location?.origin ?? ''): string {
  const trimmed = value.trim();
  if (trimmed === '') return trimmed;
  // Already absolute: any scheme, plus the protocol-relative `//host/path`
  // form, which resolves on its own.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) return trimmed;
  if (origin === '') return trimmed;
  return trimmed.startsWith('/') ? `${origin}${trimmed}` : `${origin}/${trimmed}`;
}

/**
 * The OpenAI-compatible base URL that belongs beside the API URL.
 *
 * `/llm/v1` is a sibling of `/api/v2` on the same origin, so the base is the
 * API URL with its `/api/v2` suffix replaced. The result is absolute for the
 * reason above.
 */
export function toOpenAiBaseUrl(apiUrl: string, origin?: string): string {
  const trimmed = apiUrl.trim();
  if (trimmed === '') return trimmed;
  return toAbsoluteApiUrl(`${trimmed.replace(/\/api\/v2\/?$/, '')}/llm/v1`, origin);
}
