/**
 * MSW handlers for unit S6's artifacts transport (spec §5.7 rows 1, 3, 5).
 * Same R-M2/R-M3/R-M4 discipline as transport.ts (unit F4): every response
 * body derives from a fixture file, validated at registration time.
 *
 * Routing note (see fixture `note` fields for citations): the S3-proxy
 * probes (`s3Put*`, `bucketList*`, `artifactList*`) match a ROOT-LEVEL path
 * (no `/api/v2`, router.go:165-169) while `artifactContent*` matches a path
 * mounted UNDER `/api/v2` (router.go:604-605) — the two are deliberately
 * different endpoints, not two representations of the same one.
 */
import { http, HttpResponse } from 'msw';
import type { RequestHandler } from 'msw';
import { z } from 'zod';
import type { ZodType } from 'zod';

import { registerValidatedHandlers } from '../register';
import artifactContent200 from '../fixtures/artifacts/artifact-content.200.json';
import artifactList200 from '../fixtures/artifacts/artifact-list.200.json';
import bucketList200 from '../fixtures/artifacts/bucket-list.200.json';
import notFound404 from '../fixtures/artifacts/error.404.json';
import s3Put200 from '../fixtures/artifacts/s3-put.200.json';

const s3PutBody = z.object({ etag: z.string() });
const bucketListBody = z.object({
  buckets: z.array(z.object({ name: z.string(), created_at: z.string() })),
});
const artifactListBody = z.object({
  objects: z.array(z.object({ key: z.string(), size: z.number() })),
});
const contentBody = z.string();
const errorBody = z.object({ error: z.string() });

/** Request facts captured for assertions (headers/credentials, §5.7 probes). */
export interface CapturedArtifactsRequest {
  url: string;
  method: string;
  credentials: RequestCredentials;
  authorization: string | null;
  contentType: string | null;
  bodyText: string | null;
}

async function capture(request: Request, sink?: CapturedArtifactsRequest[]): Promise<void> {
  if (sink === undefined) return;
  const bodyText = request.method === 'GET' || request.method === 'HEAD' ? null : await request.clone().text();
  sink.push({
    url: request.url,
    method: request.method,
    credentials: request.credentials,
    authorization: request.headers.get('authorization'),
    contentType: request.headers.get('content-type'),
    bodyText,
  });
}

/** R-M3 seam: validate one entry through F2's registration wrapper. */
function validated(id: string, schema: ZodType, fixture: { recordedAt: string; body: unknown }, handler: RequestHandler): RequestHandler {
  const [first] = registerValidatedHandlers([{ id, handler, schema, fixture }]);
  if (first === undefined) throw new Error(`artifacts handlers: registration returned nothing for ${id}`);
  return first;
}

/* ── row 1: S3 direct PUT (root-level, no /api/v2) ───────────────────────── */

export function s3PutOk(sink?: CapturedArtifactsRequest[]): RequestHandler {
  return validated('artifacts.s3.put.ok', s3PutBody, s3Put200, http.put('*/artifacts/s3/*', async ({ request }) => {
    await capture(request, sink);
    return HttpResponse.json(s3Put200.body);
  }));
}

export function s3PutNotFound(): RequestHandler {
  return validated('artifacts.s3.put.notFound', errorBody, notFound404, http.put('*/artifacts/s3/*', () =>
    HttpResponse.json(notFound404.body, { status: 404 }),
  ));
}

export function s3PutNetworkError(): RequestHandler {
  return http.put('*/artifacts/s3/*', () => HttpResponse.error());
}

/* ── row 5: bucket / artifact list (root-level, no /api/v2) ──────────────── */

export function bucketListOk(sink?: CapturedArtifactsRequest[]): RequestHandler {
  return validated('artifacts.bucketList.ok', bucketListBody, bucketList200, http.get('*/artifacts/s3/', async ({ request }) => {
    await capture(request, sink);
    return HttpResponse.json(bucketList200.body);
  }));
}

export function bucketListNetworkError(): RequestHandler {
  return http.get('*/artifacts/s3/', () => HttpResponse.error());
}

export function bucketListNotFound(): RequestHandler {
  return validated('artifacts.bucketList.notFound', errorBody, notFound404, http.get('*/artifacts/s3/', () =>
    HttpResponse.json(notFound404.body, { status: 404 }),
  ));
}

/** 200 with a non-JSON body — exercises parseJsonBody's catch (raw-text) branch. */
export function bucketListLyingJson(): RequestHandler {
  return http.get('*/artifacts/s3/', () => new HttpResponse('not json', { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

export function artifactListOk(sink?: CapturedArtifactsRequest[]): RequestHandler {
  return validated('artifacts.artifactList.ok', artifactListBody, artifactList200, http.get('*/artifacts/s3/:bucket', async ({ request }) => {
    await capture(request, sink);
    return HttpResponse.json(artifactList200.body);
  }));
}

export function artifactListNetworkError(): RequestHandler {
  return http.get('*/artifacts/s3/:bucket', () => HttpResponse.error());
}

/* ── row 3: artifact content blob (mounted UNDER /api/v2) ────────────────── */

export function artifactContentOk(sink?: CapturedArtifactsRequest[]): RequestHandler {
  return validated('artifacts.content.ok', contentBody, artifactContent200, http.get('*/artifacts/artifact/default/*', async ({ request }) => {
    await capture(request, sink);
    return HttpResponse.text(artifactContent200.body);
  }));
}

export function artifactContentNotFound(): RequestHandler {
  return validated('artifacts.content.notFound', errorBody, notFound404, http.get('*/artifacts/artifact/default/*', () =>
    HttpResponse.json(notFound404.body, { status: 404 }),
  ));
}

export function artifactContentNetworkError(): RequestHandler {
  return http.get('*/artifacts/artifact/default/*', () => HttpResponse.error());
}

/** Serves a distinct blob per requested file path — the ZIP-loop probe. */
export function artifactContentByPath(bodies: Readonly<Record<string, string>>, sink?: CapturedArtifactsRequest[]): RequestHandler {
  return http.get('*/artifacts/artifact/default/*', async ({ request }) => {
    await capture(request, sink);
    const pathname = new URL(request.url).pathname;
    const key = Object.keys(bodies).find((k) => pathname.endsWith(k));
    const body = key === undefined ? undefined : bodies[key];
    if (body === undefined) return new HttpResponse(null, { status: 404 });
    return HttpResponse.text(body);
  });
}
