/**
 * Ported verbatim from `apps/elitea-ui/src/[fsd]/features/toolkits/lib/
 * helpers/openApi.helpers.js` (116 lines, Wave-2 unit A4b). Pure, no
 * external dependencies in the baseline.
 *
 * `generateOperationId` MUST produce identical output to the backend's
 * Python `_generate_operation_id()` — comment preserved from the baseline
 * verbatim, this is a wire-compatibility requirement (UI preview of a tool
 * name must match what the server actually generates), not a style
 * preference.
 */

const MAX_OPERATION_ID_LENGTH = 64;

/** Must match backend `_METHOD_TO_ACTION` mapping. */
const METHOD_TO_ACTION: Readonly<Record<string, string>> = {
  get: 'get',
  post: 'create',
  put: 'update',
  patch: 'update',
  delete: 'delete',
  head: 'head',
  options: 'options',
  trace: 'trace',
};

const OPERATION_METHODS: ReadonlySet<string> = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'trace',
]);

/**
 * Generate an operationId from HTTP method and path when not provided in
 * spec.
 *
 * @example
 * generateOperationId('GET', '/users') // => 'get_users'
 * generateOperationId('GET', '/users/{id}') // => 'get_users_by_id'
 * generateOperationId('POST', '/users') // => 'create_users'
 * generateOperationId('PUT', '/users/{id}') // => 'update_users_by_id'
 * generateOperationId('PATCH', '/users/{id}') // => 'update_users_by_id'
 * generateOperationId('DELETE', '/api/v1/items/{itemId}') // => 'delete_api_v1_items_by_itemId'
 */
export function generateOperationId(method: string, path: string): string {
  const methodLower = method.toLowerCase();
  const action = METHOD_TO_ACTION[methodLower] ?? methodLower;

  const segments = path.split('/').filter((segment) => segment !== '');
  const processedSegments: string[] = [];

  for (const segment of segments) {
    if (segment.startsWith('{') && segment.endsWith('}')) {
      const paramName = segment.slice(1, -1);
      processedSegments.push(`by_${paramName}`);
    } else {
      const cleanSegment = segment.replace(/[^a-zA-Z0-9]/g, '_');
      if (cleanSegment !== '') processedSegments.push(cleanSegment);
    }
  }

  // Edge case: root path "/"
  const baseId = processedSegments.length > 0 ? `${action}_${processedSegments.join('_')}` : `${action}_root`;

  const prefixedId = /^\d/.test(baseId) ? `_${baseId}` : baseId;

  let finalId = prefixedId;
  if (prefixedId.length > MAX_OPERATION_ID_LENGTH) {
    let truncated = prefixedId.slice(0, MAX_OPERATION_ID_LENGTH);
    const lastUnderscore = truncated.lastIndexOf('_');
    if (lastUnderscore > 0) {
      truncated = truncated.slice(0, lastUnderscore);
    }
    finalId = truncated.replace(/_+$/, '');
  }

  return finalId;
}

/** Not exported: no current caller needs these two apart from `OpenApiDocument` below (which is exported and consumed by `openAPIExtract`'s callers). */
interface OpenApiOperation {
  readonly operationId?: string;
  readonly description?: string;
  readonly summary?: string;
}

type OpenApiPathItem = Readonly<Record<string, OpenApiOperation>>;

export interface OpenApiDocument {
  readonly paths?: Readonly<Record<string, OpenApiPathItem>>;
}

export interface ExtractedOpenApiOperation {
  readonly name: string;
  readonly path: string;
  readonly method: string;
  readonly description: string | undefined;
}

/** Flattens an OpenAPI document's `paths` into one entry per HTTP operation, filling in a missing `operationId` via `generateOperationId`. Returns `[]` for a falsy input. */
export function openAPIExtract(openAPIJson: OpenApiDocument | undefined): readonly ExtractedOpenApiOperation[] {
  if (!openAPIJson) return [];

  const result: ExtractedOpenApiOperation[] = [];
  const paths = openAPIJson.paths ?? {};

  for (const [path, pathItem] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!OPERATION_METHODS.has(method.toLowerCase())) continue;

      const name = operation.operationId || generateOperationId(method, path);
      result.push({
        name,
        path,
        method,
        description: operation.description || operation.summary,
      });
    }
  }

  return result;
}
