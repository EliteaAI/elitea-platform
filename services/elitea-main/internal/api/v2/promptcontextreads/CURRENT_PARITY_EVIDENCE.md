# Current prompt-context read parity

This slice owns two current-baseline, read-only HTTP contracts. It is disabled
unless `ELITEA_PROMPT_CONTEXT_READS_ENABLED=true`; startup additionally requires
the reviewed production authentication graph and
`ELITEA_CONFIGURATIONS_ENABLED=true`. The project-context `PUT` and `DELETE`
contracts remain with the current application and are not mounted here.

## Pinned source evidence

| Current source | SHA-256 | Behavior carried forward |
| --- | --- | --- |
| `elitea_core/api/v2/chat_config.py` | `2bf374344b90336b3251b5bdcbf85882f05fcbc4d482a7a54408bf3096cca68d` | GET path, permission, five keys, defaults, Python `int(value)` |
| `elitea_core/api/v2/project_context.py` | `e983d63c8bf3ea860f4e595f0edfa4f67bfd5b3ebf94630781d9b2814ec6f61e` | GET path, permission, five-second configuration call, project-only lookup |
| `elitea_core/models/pd/project_context.py` | `65b422f833974bd682917910cda921c33baa6c1dd5fa3a570deed0bd88ac8081` | exact `id`, `content`, `enabled`, `updated_at` projection and defaults |
| `shared/tools/vault_tools.py` | `193b16914e7c37038b335528b3c70fb25dd1dc956c5c4a75440a349bc9b1b3dd` | shared admin regular, project hidden, project regular merge order |
| `configurations/rpc/getters.py` | `a93047fada262940bed6d0cb82fb9dada217bd44061c6b7ca8708d0ee2689e7e` | project-context RPC has no public/shared fallback |
| `configurations/utils_getters.py` | `42904ca561b7decec3479bc749be001fe5a4375d89899ed32423a1064c0f0bd6` | tenant query filters `project_id` and `type`, uses `LIMIT 1` semantics without ordering |

The checked-in static RBAC catalog still records project-context source hash
`c74644199a8ee0623083fe88990cc2f5aa1b867c4e103a4d47bb0bc0097e8229`
and omits the subsequently added `DELETE`. It must be regenerated in its
inventory-owner workflow. This read-only port follows the current source above
and deliberately does not expand scope to either mutation.

## Functional matrix

| Contract | Current behavior | Go owner and evidence |
| --- | --- | --- |
| `GET /api/v2/elitea_core/chat_config/prompt_lib/{projectID}` | requires `models.chat.conversation.details` in default/prompt-lib mode | `CurrentRoutes`; unit and real PostgreSQL HTTP tests deny missing membership, wrong permission, suspended user/project and cross-project access before vault reads |
| Secret precedence | project regular > project hidden > admin regular > default; admin hidden is not shared | `CurrentChatConfigVaultReader`; one admin and one project snapshot per request; precedence and encrypted PostgreSQL fixtures |
| Integer conversion | Python `int`: booleans, arbitrary JSON integers, binary64 JSON-float truncation, decimal strings including underscores/Unicode digits; quoted float text and null fail | `centrysecrets.LookupPythonInteger`; Python-derived golden vectors include `1e100`, underflow, fractional signs, booleans, big integers and malformed values. A single encoded value is bounded by the current writer's existing 8 MiB whole-vault ceiling; larger pre-writer data fails with the same 500 corruption outcome rather than allocating an unbounded response |
| Successful chat response | exactly five JSON integer keys, no model catalog fields | `CurrentChatConfig` and exact-body handler/integration assertions |
| Missing chat key | endpoint constant | exact defaults `10`, `150`, `150`, `10`, `3` |
| Present malformed chat value or unavailable vault | HTTP 500 | fail-closed tests; response is the current safe `{"message":"Internal Server Error"}` and never includes secret material |
| `GET /api/v2/elitea_core/project_context/prompt_lib/{projectID}/project-context` | requires `models.project_context.view` in default/prompt-lib mode | `CurrentRoutes`; same production authentication/RBAC chain |
| Project-context storage | only `p_<authorized project>.configuration`, `row.project_id = projectID`, `type = 'project_context'`, `LIMIT 1`, deliberately no `ORDER BY` and no public fallback | transaction-local `tenant.Executor`; real PostgreSQL test places a wrong-project canary in the selected tenant schema and proves it is ignored |
| Missing row | `{"id":null,"content":"","enabled":true,"updated_at":null}` | exact-body unit and PostgreSQL tests |
| Existing row | stored ID and naive timestamp, data defaults, Pydantic-compatible boolean coercion | parser and real PostgreSQL timestamp tests |
| Falsey/null data | defaults content to empty and enabled to true while retaining row ID/timestamp | parser matrix |
| Corrupt truthy data | HTTP 500 | parser and handler failure tests |
| Time budget | five seconds around the project-context storage operation | `CurrentProjectContextTimeout`; caller cancellation remains authoritative |
| Methods outside scope | project-context PUT/DELETE are not exposed | production-router tests require 405 when the GET route is composed |

Recommended-role comments are documentation only. Authorization is resolved
from the current PostgreSQL role bindings and exact permission strings through
`legacyrbac.PostgresResolver`; the test matrix does not infer grants from role
names.

## Evidence boundary

- Unit/component: parser golden vectors, defaults, precedence, exact JSON,
  route matching, auth-before-read, permission-before-read, failure redaction.
- Service integration: independently created PostgreSQL database, current
  encrypted Fernet vault tables, tenant schemas, current user and project RBAC,
  active forwarded user and PAT identities, suspension and tenant isolation.
- Concurrency/static: focused `go test -race` and `go vet` are required before
  integration.

This evidence does not claim a deployed browser checkpoint, penetration test,
load/soak result, or mutation parity.
