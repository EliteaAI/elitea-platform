/**
 * MSW handlers for unit S6's chunked-upload transport (spec §5.7 row 2).
 * Same R-M2/R-M3/R-M4 discipline as transport.ts. These probes exercise the
 * ONE sanctioned XMLHttpRequest (R-A4) — msw/node's XMLHttpRequestInterceptor
 * patches XMLHttpRequest directly (no Service Worker involved, unlike the
 * browser integration), so it intercepts these XHR calls exactly like fetch,
 * INCLUDING synthesizing upload progress events for request bodies
 * (@mswjs/interceptors XMLHttpRequestController.respondWith:304-330 fires a
 * single loadstart/progress/load/loadend with loaded=total=body length).
 *
 * IMPORTANT environment note: these handlers deliberately NEVER call
 * `request.formData()` / `.text()` / `.arrayBuffer()` on the intercepted
 * request. Under vitest's jsdom environment, `FormData`/`Blob` on
 * `globalThis` are jsdom's own classes, but `@mswjs/interceptors` re-wraps
 * every XHR body into a NODE-NATIVE `Request` (undici) for handler matching
 * (XMLHttpRequestController.ts:675-685, `new FetchRequest(url, {body:
 * rawFormData})`). Node's multipart parser does not recognise a jsdom
 * `FormData`'s entries as valid `File`/`Blob` webidl values and throws when
 * asked to re-parse them (`request.formData()`) — a cross-realm jsdom/undici
 * interoperability gap, not a defect in `upload.ts`. Field-content
 * assertions therefore happen CLIENT-SIDE in upload.test.ts, via
 * `vi.spyOn(FormData.prototype, 'append')`, which is realm-safe. Reading
 * `request.headers` / `.credentials` / `.url` (never the body) is safe and
 * used here for the header/credentials probes.
 */
import { http, HttpResponse } from 'msw';
import type { RequestHandler } from 'msw';
import { z } from 'zod';
import type { ZodType } from 'zod';

import { registerValidatedHandlers } from '../register';
import chunkComplete201 from '../fixtures/upload/chunk-complete.201.json';
import chunkInProgress202 from '../fixtures/upload/chunk-in-progress.202.json';
import error500 from '../fixtures/upload/error.500.json';
import smallFile201 from '../fixtures/upload/small-file.201.json';

/*
 * These two schemas are the GO handler's contract, not the legacy Python one
 * they used to describe (services/elitea-main/internal/api/v2/conversations/
 * attachments.go:348 and :461). The statuses are the real ones too — 202 for a
 * chunk the server has taken but not assembled, 201 for the assembled file —
 * which is what makes `upload.ts:161`'s `status >= 200 && status < 300` a
 * tested claim rather than an untested one: every previous fixture answered
 * 200, so nothing here ever exercised a 2xx that was not 200.
 */
const inProgressBody = z.object({
  status: z.literal('chunk_received'),
  file_id: z.string(),
  chunk_index: z.number(),
  total_chunks: z.number(),
  message: z.string(),
});
const chunkAckArrayBody = z.array(z.object({ filepath: z.string(), file_size: z.number() }));
const errorBody = z.object({ error: z.string() });

const UPLOAD_PATH = '*/elitea_core/attachments/prompt_lib/*';

/** Request facts captured for assertions (headers/credentials, §5.7 row 2 probes) — body NEVER read, see module doc. */
export interface CapturedUploadRequest {
  url: string;
  method: string;
  credentials: RequestCredentials;
  authorization: string | null;
  cacheControl: string | null;
  contentType: string | null;
}

function capture(request: Request, sink?: CapturedUploadRequest[]): void {
  if (sink === undefined) return;
  sink.push({
    url: request.url,
    method: request.method,
    credentials: request.credentials,
    authorization: request.headers.get('authorization'),
    cacheControl: request.headers.get('cache-control'),
    contentType: request.headers.get('content-type'),
  });
}

/** R-M3 seam: validate one entry through F2's registration wrapper. */
function validated(id: string, schema: ZodType, fixture: { recordedAt: string; body: unknown }, handler: RequestHandler): RequestHandler {
  const [first] = registerValidatedHandlers([{ id, handler, schema, fixture }]);
  if (first === undefined) throw new Error(`upload handlers: registration returned nothing for ${id}`);
  return first;
}

/** Always responds with the in-progress ack — pair with chunkAckComplete() via sequential server.use() calls to model a real chunk sequence. */
export function chunkAckInProgress(sink?: CapturedUploadRequest[]): RequestHandler {
  return validated('upload.chunk.inProgress', inProgressBody, chunkInProgress202, http.post(UPLOAD_PATH, ({ request }) => {
    capture(request, sink);
    return HttpResponse.json(chunkInProgress202.body, { status: 202 });
  }));
}

/** Always responds with the final-chunk ack. */
export function chunkAckComplete(sink?: CapturedUploadRequest[]): RequestHandler {
  return validated('upload.chunk.complete', chunkAckArrayBody, chunkComplete201, http.post(UPLOAD_PATH, ({ request }) => {
    capture(request, sink);
    return HttpResponse.json(chunkComplete201.body, { status: 201 });
  }));
}

export function smallFileOk(sink?: CapturedUploadRequest[]): RequestHandler {
  return validated('upload.small.ok', chunkAckArrayBody, smallFile201, http.post(UPLOAD_PATH, ({ request }) => {
    capture(request, sink);
    return HttpResponse.json(smallFile201.body, { status: 201 });
  }));
}

export function uploadServerError(): RequestHandler {
  return validated('upload.error.500', errorBody, error500, http.post(UPLOAD_PATH, () =>
    HttpResponse.json(error500.body, { status: 500 }),
  ));
}

export function uploadNetworkError(): RequestHandler {
  return http.post(UPLOAD_PATH, () => HttpResponse.error());
}

/**
 * Responds in_progress for every call except the `finalCallNumber`-th
 * (1-based), which gets the complete ack. Call-count based (never reads the
 * body, see module doc) — models a real multi-chunk sequence for
 * `uploadFileWithProgress`, whose chunk loop awaits each POST sequentially
 * so call order == chunk order.
 */
export function chunkAckSequence(finalCallNumber: number, sink?: CapturedUploadRequest[]): RequestHandler {
  let callCount = 0;
  return http.post(UPLOAD_PATH, ({ request }) => {
    callCount += 1;
    capture(request, sink);
    return callCount === finalCallNumber
      ? HttpResponse.json(chunkComplete201.body, { status: 201 })
      : HttpResponse.json(chunkInProgress202.body, { status: 202 });
  });
}
