/**
 * R-A6 (issue #132): API response envelopes are unwrapped ONLY by
 * `src/shared/api/unwrap.ts` (`unwrapList` / `unwrapListPage`), never by hand
 * at the call site.
 *
 * `eliteaFetch` resolves `{data, status, headers}`, so `resp.data` is the
 * body — but the bodies are not uniform (`{rows,total}`,
 * `{items,total,page,…}` and bare arrays all occur). Copying a working
 * expression to a new endpoint is therefore actively wrong, and being wrong is
 * SILENT: `undefined` → `[]` → an empty-state render, 200 in the network tab,
 * nothing in the console. Four agents on four unrelated journeys each hit that
 * in one pass; this rule is what stops the fifth.
 *
 * Two hand-rolled forms are fenced:
 *
 *  1. A hard `X.data.data` chain. After `eliteaFetch` the envelope is settled
 *     and non-optional, so a SECOND `.data` on it is the "one level too deep"
 *     bug verbatim (`resp.data.data.rows` — `pages/settings/Users.tsx:107`).
 *     `query.data?.data` — react-query's always-`| undefined` `data` holding
 *     the envelope — is the legitimate orval read and stays allowed; it is the
 *     optional link that distinguishes them, and ~60 call sites in the tree
 *     already write it that way. A `.data.data` chain reaching straight into
 *     `.rows`/`.items` is reported whether or not the links are optional:
 *     that combination has no correct reading.
 *  2. `'rows' in x` / `'items' in x` shape sniffing — the branch that turned
 *     `useChatPageData` into a TypeError on every `/app/chat/:id` deep link,
 *     because neither arm matched and the fallback was the response itself.
 *
 * The helper module is exempted by path in .oxlintrc.json, the same way
 * `shared/api/http.ts` is the one sanctioned `fetch` (R-A1).
 */
const LIST_KEYS = new Set(['rows', 'items']);

const HELPER_HINT = 'use unwrapList/unwrapListPage from @/shared/api/unwrap';

/** `x.data` (or `x?.data`) — a non-computed member read of `data`. */
function isDataRead(node) {
  return (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.property.type === 'Identifier' &&
    node.property.name === 'data'
  );
}

/** `x.data.data` in either optionality — the object of a `.data` read is itself a `.data` read. */
function isDoubleDataChain(node) {
  return isDataRead(node) && isDataRead(node.object);
}

export const noAdHocEnvelopeUnwrap = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'R-A6: response envelopes are unwrapped only by shared/api/unwrap.ts — no `.data.data` chains, no hand-rolled `\'rows\' in x` sniffing',
    },
    schema: [],
  },
  create(context) {
    // `.data.data` nodes already covered by the more specific list-key message
    // below. Visitors run parent-before-child, so the outer `…​.rows` node is
    // always seen first and can claim the inner chain.
    const claimed = new WeakSet();

    return {
      MemberExpression(node) {
        // `…data.data.rows` / `…data.data.items`: the Users.tsx bug verbatim.
        // Reported regardless of optionality — reaching a list key through a
        // doubled `.data` has no correct reading.
        if (!node.computed && node.property.type === 'Identifier' && LIST_KEYS.has(node.property.name)) {
          if (isDoubleDataChain(node.object)) {
            claimed.add(node.object);
            context.report({
              node,
              message: `R-A6: \`.data.data.${node.property.name}\` — hand-rolled envelope unwrap, and one level too deep; ${HELPER_HINT} (issue #132)`,
            });
            return;
          }
        }

        // A hard (non-optional) `.data.data`. react-query's `query.data?.data`
        // is the sanctioned read and is not reported.
        if (isDoubleDataChain(node) && node.optional !== true && !claimed.has(node)) {
          context.report({
            node,
            message: `R-A6: \`.data.data\` — \`eliteaFetch\` already unwraps the transport, so a second \`.data\` reads undefined and renders as an empty state; ${HELPER_HINT} (issue #132)`,
          });
        }
      },

      BinaryExpression(node) {
        if (node.operator !== 'in') return;
        const key = node.left;
        if (key.type !== 'Literal' || typeof key.value !== 'string' || !LIST_KEYS.has(key.value)) return;
        context.report({
          node,
          message: `R-A6: hand-rolled \`'${key.value}' in x\` response-shape sniffing — the shapes differ per endpoint and the fallback must never be the input; ${HELPER_HINT} (issue #132)`,
        });
      },
    };
  },
};
