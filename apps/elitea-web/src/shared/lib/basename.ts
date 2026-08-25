/**
 * Normalizes a configured SPA basename so a caller can join it to a
 * leading-slash path.
 *
 * WHY THIS EXISTS. `vite_base_uri` is written by `docker-entrypoint.sh` and
 * defaults to `/app/` — with a trailing slash. Four modules join that value to
 * a path literal that already starts with `/`, and the naive join makes an
 * empty path segment: `https://host/app//mcp-auth-callback`.
 *
 * Inside the app that extra slash is harmless, because the router re-parses
 * the URL. It is not harmless in an OAuth `redirect_uri`. RFC 6749 3.1.2.3
 * makes the authorization server compare the redirect URI as a simple string,
 * so `https://host/app//mcp-auth-callback` does not match the
 * `https://host/app/mcp-auth-callback` the operator registered, and the flow
 * ends in `redirect_uri_mismatch`.
 *
 * Result contract: an empty string, or a value that starts with `/` and does
 * not end with one. `''` and `'/'` both give `''`, so `${base}${path}` is
 * always a well-formed path.
 */
export function normalizeBasename(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  const withoutTrailing = trimmed.replace(/\/+$/, '');
  if (withoutTrailing === '') return '';
  return withoutTrailing.startsWith('/') ? withoutTrailing : `/${withoutTrailing}`;
}
