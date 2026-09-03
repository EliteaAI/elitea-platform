/**
 * Proof for scripts/lib/github-issue.mjs.
 *
 * R-M1 (§6.5) bans `vi.mock` of application modules outside src/**\/__mocks__/,
 * and this file is not under that path. So the network boundary substituted
 * here is a REAL local HTTP server (`node:http`), not a mocked `node:https` —
 * `apiHost` and `requestFn` exist on the exported function for exactly this:
 * they let production code run unmodified against `127.0.0.1` instead of
 * `api.github.com`, over plain HTTP instead of TLS, with no module mocked.
 */
import { createServer, request as httpRequest } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createOrUpdateGitHubIssue } from './github-issue.mjs';

/** Start a real HTTP server on an OS-assigned loopback port. */
function startServer(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** requestFn wired to a running server: same node:http.request, fixed port. */
function requestFnFor(server) {
  const { port } = server.address();
  return (options, callback) => httpRequest({ ...options, hostname: '127.0.0.1', port }, callback);
}

/** Collect the JSON body of an incoming request before the handler responds. */
function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : null); }
      catch { resolve(raw); }
    });
  });
}

describe('createOrUpdateGitHubIssue', () => {
  const ORIGINAL_ENV = { ...process.env };
  let server;
  let hits;

  beforeEach(() => {
    hits = [];
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPOSITORY;
  });

  afterEach(async () => {
    process.env = { ...ORIGINAL_ENV };
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = undefined;
    }
  });

  it('is a no-op when neither GITHUB_TOKEN nor GITHUB_REPOSITORY is set (local run)', async () => {
    // No opts at all: every default (labels, logPrefix, userAgent, apiHost,
    // requestFn) is destructured here, before the guard below ever runs.
    await expect(createOrUpdateGitHubIssue('t', 'b')).resolves.toBeUndefined();
  });

  it('is a no-op when GITHUB_TOKEN is set but GITHUB_REPOSITORY is not', async () => {
    process.env.GITHUB_TOKEN = 'tok';
    server = await startServer((req, res) => {
      hits.push(req.url);
      res.writeHead(500);
      res.end();
    });
    await createOrUpdateGitHubIssue('t', 'b', { requestFn: requestFnFor(server) });
    expect(hits).toHaveLength(0);
  });

  it('creates a new issue when the search finds none open with the same title', async () => {
    process.env.GITHUB_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    const seenRequests = [];
    server = await startServer(async (req, res) => {
      const body = await readJsonBody(req);
      seenRequests.push({ method: req.method, url: req.url, headers: { ...req.headers }, body });
      if (req.method === 'GET' && req.url.startsWith('/search/issues')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ total_count: 0, items: [] }));
        return;
      }
      if (req.method === 'POST' && req.url === '/repos/owner/repo/issues') {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ number: 42, html_url: 'https://github.com/owner/repo/issues/42' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await createOrUpdateGitHubIssue('Incident: something broke', 'the details', {
      labels: ['deepwiki', 'ci-incident'],
      logPrefix: '[test-prefix]',
      userAgent: 'test-agent/1.0',
      apiHost: '127.0.0.1',
      requestFn: requestFnFor(server),
    });

    const search = seenRequests.find((r) => r.url.startsWith('/search/issues'));
    expect(search.headers.authorization).toBe('Bearer tok');
    expect(search.headers['user-agent']).toBe('test-agent/1.0');
    // GET carries no body, so no Content-Type/Content-Length header pair.
    expect(search.headers['content-type']).toBeUndefined();

    const create = seenRequests.find((r) => r.method === 'POST' && r.url === '/repos/owner/repo/issues');
    expect(create).toBeDefined();
    expect(create.headers['content-type']).toBe('application/json');
    expect(create.body).toEqual({
      title: 'Incident: something broke',
      body: 'the details',
      labels: ['deepwiki', 'ci-incident'],
    });
  });

  it('logs but does not throw when issue creation fails (non-201)', async () => {
    process.env.GITHUB_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    server = await startServer(async (req, res) => {
      await readJsonBody(req);
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ total_count: 0, items: [] }));
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'nope' }));
    });

    await expect(
      createOrUpdateGitHubIssue('t', 'b', { apiHost: '127.0.0.1', requestFn: requestFnFor(server) }),
    ).resolves.toBeUndefined();
  });

  it('falls through to the create path when the search response is not valid JSON', async () => {
    // Exercises ghRequest's JSON.parse catch branch: a 200 with an unparsable
    // body resolves with { status, body: <raw string> }, and total_count on a
    // string is undefined — so this behaves like "no existing issue" rather
    // than crashing.
    process.env.GITHUB_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    let createHit = false;
    server = await startServer(async (req, res) => {
      await readJsonBody(req);
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('not json at all');
        return;
      }
      createHit = true;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ number: 1, html_url: 'x' }));
    });

    await createOrUpdateGitHubIssue('t', 'b', { apiHost: '127.0.0.1', requestFn: requestFnFor(server) });
    expect(createHit).toBe(true);
  });

  it('falls through to the create path when the search itself errors (non-200)', async () => {
    process.env.GITHUB_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    let createHit = false;
    server = await startServer(async (req, res) => {
      await readJsonBody(req);
      if (req.method === 'GET') {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'unavailable' }));
        return;
      }
      createHit = true;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ number: 1, html_url: 'x' }));
    });

    await createOrUpdateGitHubIssue('t', 'b', { apiHost: '127.0.0.1', requestFn: requestFnFor(server) });
    expect(createHit).toBe(true);
  });

  it('comments on an existing open issue with the same title instead of duplicating it', async () => {
    process.env.GITHUB_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    const seenRequests = [];
    server = await startServer(async (req, res) => {
      const body = await readJsonBody(req);
      seenRequests.push({ method: req.method, url: req.url, body });
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          total_count: 1,
          items: [{ number: 7, html_url: 'https://github.com/owner/repo/issues/7' }],
        }));
        return;
      }
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 99 }));
    });

    await createOrUpdateGitHubIssue('t', 'the new body', {
      apiHost: '127.0.0.1',
      requestFn: requestFnFor(server),
    });

    const comment = seenRequests.find((r) => r.url === '/repos/owner/repo/issues/7/comments');
    expect(comment).toBeDefined();
    expect(comment.body).toEqual({ body: 'the new body' });
    // Never opens a second issue when one is already open.
    expect(seenRequests.some((r) => r.method === 'POST' && r.url === '/repos/owner/repo/issues')).toBe(false);
  });

  it('logs but does not throw when commenting on the existing issue fails (non-201)', async () => {
    process.env.GITHUB_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    server = await startServer(async (req, res) => {
      await readJsonBody(req);
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ total_count: 1, items: [{ number: 7, html_url: 'x' }] }));
        return;
      }
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'forbidden' }));
    });

    await expect(
      createOrUpdateGitHubIssue('t', 'b', { apiHost: '127.0.0.1', requestFn: requestFnFor(server) }),
    ).resolves.toBeUndefined();
  });

  it('rejects when the underlying request errors (e.g. connection refused)', async () => {
    process.env.GITHUB_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    // Bind and immediately close: the port is very likely free for the
    // duration of this test, and nothing is listening on it — a real
    // ECONNREFUSED, not a simulated one.
    const probe = await startServer((_req, res) => res.end());
    const { port } = probe.address();
    await new Promise((resolve) => probe.close(resolve));

    await expect(
      createOrUpdateGitHubIssue('t', 'b', {
        apiHost: '127.0.0.1',
        requestFn: (options, callback) => httpRequest({ ...options, hostname: '127.0.0.1', port }, callback),
      }),
    ).rejects.toThrow();
  });
});
