/**
 * MSW handlers for unit S6's markdown-export transport (spec §5.7 row 4).
 * Same R-M2/R-M3/R-M4 discipline as transport.ts.
 */
import { http, HttpResponse } from 'msw';
import type { RequestHandler } from 'msw';
import { z } from 'zod';
import type { ZodType } from 'zod';

import { registerValidatedHandlers } from '../register';
import error404 from '../fixtures/download/error.404.json';
import export200 from '../fixtures/download/export.200.json';

const exportBody = z.string();
const errorBody = z.object({ error: z.string() });

const EXPORT_PATH = '*/elitea_core/export_import/prompt_lib/*';

export interface CapturedExportRequest {
  url: string;
  authorization: string | null;
}

function validated(id: string, schema: ZodType, fixture: { recordedAt: string; body: unknown }, handler: RequestHandler): RequestHandler {
  const [first] = registerValidatedHandlers([{ id, handler, schema, fixture }]);
  if (first === undefined) throw new Error(`download handlers: registration returned nothing for ${id}`);
  return first;
}

/** 200 with a Content-Disposition header carrying `filename`. */
export function exportOk(filename: string, sink?: CapturedExportRequest[]): RequestHandler {
  return validated('download.export.ok', exportBody, export200, http.get(EXPORT_PATH, ({ request }) => {
    sink?.push({ url: request.url, authorization: request.headers.get('authorization') });
    return new HttpResponse(export200.body, {
      status: 200,
      headers: { 'Content-Type': 'text/markdown', 'Content-Disposition': `attachment; filename="${filename}"` },
    });
  }));
}

/** 200 with NO Content-Disposition header — the fallback-filename branch. */
export function exportNoContentDisposition(): RequestHandler {
  return validated('download.export.noHeader', exportBody, export200, http.get(EXPORT_PATH, () =>
    new HttpResponse(export200.body, { status: 200, headers: { 'Content-Type': 'text/markdown' } }),
  ));
}

export function exportNotFound(): RequestHandler {
  return validated('download.export.notFound', errorBody, error404, http.get(EXPORT_PATH, () =>
    HttpResponse.json(error404.body, { status: 404 }),
  ));
}

export function exportNetworkError(): RequestHandler {
  return http.get(EXPORT_PATH, () => HttpResponse.error());
}
