/**
 * Shared GitHub incident-issue filing, extracted from mutate-spotcheck.mjs
 * (spec §6.7 / issue #62) so a second unattended CI job — one nobody is
 * watching by design, like a weekly cron — can escalate a failure the same
 * way: a de-duplicated issue instead of a red run nobody sees.
 */
import { request as httpsRequest } from 'node:https';

/**
 * Create (or comment on, if one is already open) a GitHub issue via the
 * REST API. Requires the GITHUB_TOKEN env var and GITHUB_REPOSITORY
 * ("owner/repo") — both are unset for a local run, in which case this is a
 * deliberate no-op (logged, not thrown) so a script that calls it can still
 * be run outside CI.
 *
 * De-duplicates by searching for an open issue with the same title — if one
 * exists it adds a comment instead of opening a duplicate.
 *
 * `apiHost` and `requestFn` exist for the test in this directory: R-M1 bans
 * `vi.mock` of application modules, so github-issue.test.mjs exercises this
 * against a REAL local HTTP server instead of a mocked `node:https` — these
 * two let the test point the same code at `localhost` over plain HTTP. In
 * production neither is passed and behavior is unchanged (https to
 * api.github.com).
 *
 * @param {string} title
 * @param {string} body
 * @param {{ labels?: string[], logPrefix?: string, userAgent?: string, apiHost?: string, requestFn?: typeof httpsRequest }} [opts]
 */
export async function createOrUpdateGitHubIssue(title, body, opts = {}) {
  const {
    labels = [],
    logPrefix = '[github-issue]',
    userAgent = 'elitea-ci-incident/1.0',
    apiHost = 'api.github.com',
    requestFn = httpsRequest,
  } = opts;
  const token = process.env.GITHUB_TOKEN;
  const repoFull = process.env.GITHUB_REPOSITORY;
  if (!token || !repoFull) {
    console.log(`${logPrefix} GITHUB_TOKEN / GITHUB_REPOSITORY not set — skipping issue creation`);
    return;
  }
  const [owner, repo] = repoFull.split('/');

  function ghRequest(method, path, payload) {
    return new Promise((resolve, reject) => {
      const data = payload ? JSON.stringify(payload) : null;
      const req = requestFn(
        {
          hostname: apiHost,
          path,
          method,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': userAgent,
            ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
          },
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => { raw += c; });
          res.on('end', () => {
            try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
            catch { resolve({ status: res.statusCode, body: raw }); }
          });
        },
      );
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  // Search for existing open issue with the same title
  const q = encodeURIComponent(`repo:${owner}/${repo} is:issue is:open in:title "${title}"`);
  const search = await ghRequest('GET', `/search/issues?q=${q}&per_page=1`, null);
  if (search.status === 200 && search.body.total_count > 0) {
    const existing = search.body.items[0];
    // Add a comment to the existing issue instead of opening a duplicate
    const comment = await ghRequest('POST', `/repos/${owner}/${repo}/issues/${existing.number}/comments`, { body });
    if (comment.status === 201) {
      console.log(`${logPrefix} Added comment to existing issue #${existing.number}: ${existing.html_url}`);
    } else {
      console.log(`${logPrefix} Failed to comment on issue #${existing.number}: HTTP ${comment.status}`);
    }
    return;
  }

  // No existing issue — create one
  const created = await ghRequest('POST', `/repos/${owner}/${repo}/issues`, {
    title,
    body,
    labels,
  });
  if (created.status === 201) {
    console.log(`${logPrefix} Created issue #${created.body.number}: ${created.body.html_url}`);
  } else {
    console.log(`${logPrefix} Failed to create issue: HTTP ${created.status}`, created.body);
  }
}
