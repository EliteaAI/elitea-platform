-- 0099_gateway_request_logs.sql
--
-- The gateway's per-request LOG. It is the third and last of the gateway's
-- per-request tables, and the reason it is a third rather than a column on one
-- of the other two is the whole design:
--
--   * gateway.llm_budget_accumulators is MONEY. One row per (scope, scope_id,
--     period), and the only table budget admission reads.
--   * gateway.llm_usage_events (0084) is the BILLING LEDGER. Write-once per
--     BILLED request, so that spend can be broken down by model, project and
--     member. Its writer is the scheduler's write-back consumer, draining the
--     billing delta stream.
--   * gateway.llm_request_logs — this table — is what HAPPENED. One row per
--     request the gateway served, billed or not, succeeded or not.
--
-- THAT LAST DISTINCTION IS WHY IT EXISTS. A billing delta rides only a billed
-- request: a call refused by a budget, rejected by a policy, addressed to a
-- model that does not resolve, or failed upstream produces no delta and
-- therefore no ledger row. A "logs" view built over llm_usage_events would show
-- a list of successful requests and no failures at all — the opposite of what
-- an operator opens a log for. Adding failure rows to that ledger instead would
-- have been worse: 0084 states it is not a second money path, and every sum
-- over it would start counting requests that cost nothing.
--
-- ## NO REQUEST OR RESPONSE CONTENT IS STORED. EVER.
--
-- Not the prompt, not the completion, not the provider's error text. This table
-- answers "what happened, to whom, how often and how slowly" and is not able to
-- answer "what was in it", by construction rather than by policy.
--
-- The reason is that the alternative cannot be made safe. A prompt is
-- user-authored free text: it carries whatever the user pasted into it, which
-- in practice includes credentials, personal data and customer records. A
-- provider's error message is not safe either — upstream errors routinely quote
-- the offending fragment of the request back. So the failure column is
-- `error_code`, a CLASSIFICATION the gateway assigns, and there is no column an
-- upstream string can reach.
--
-- The path is stored as the ROUTE PATTERN (`/llm/v1/chat/completions`), never
-- the raw URL: a raw URL carries the query string, and a query string is
-- another place a caller can put a secret.
--
-- ## Cardinality and retention
--
-- This table grows with call volume — faster than llm_usage_events, because it
-- also holds the requests that were never billed. Retention is therefore
-- SHORTER than the ledger's 400 days and is enforced by the writer: the gateway
-- prunes on its own flush loop (requestlog.RetentionWindow). The window is a
-- compiled constant, not an environment variable, so no deployment can silently
-- turn a log into an unbounded table.
--
-- IDEMPOTENCE, as in 0084 and 0067: every statement is guarded, because dev and
-- dump-loaded databases reach this file in several different states.
--
-- No BEGIN/COMMIT: the ledgered runner wraps each file in one transaction with
-- its ledger row (migrate/runner.go apply).

CREATE TABLE IF NOT EXISTS gateway.llm_request_logs (
    -- A surrogate key, unlike llm_usage_events' event_id. There is no
    -- deduplication requirement here: the writer is the gateway itself, in
    -- process, and a request is recorded once by construction. BIGSERIAL also
    -- gives the listing a stable, monotonic cursor to page on, which a UUID
    -- would not.
    id                BIGSERIAL PRIMARY KEY,
    -- When the gateway finished serving the request.
    occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- NULL when the request carried no resolvable project — an unauthenticated
    -- probe, or a 404 on a path that never reached identity resolution. Those
    -- requests are still logged: "someone is hammering a route that does not
    -- exist" is exactly the question a log answers, and dropping them would
    -- make the table describe only the traffic that was already working.
    project_id        INTEGER,
    -- NULL when no member resolved, for the reason 0084 gives on the same
    -- column: "no member" and "member 0" are different claims.
    user_id           INTEGER,
    -- The chi route pattern, never the raw URL. See the header.
    route             VARCHAR(128) NOT NULL DEFAULT '',
    method            VARCHAR(8)   NOT NULL DEFAULT '',
    -- The HTTP status the gateway returned to the caller.
    status            SMALLINT NOT NULL DEFAULT 0,
    -- Wall-clock milliseconds from the start of the handler to the response
    -- being complete. For a streamed response that is the whole stream, which
    -- is the number an operator investigating "chat feels slow" wants.
    duration_ms       INTEGER NOT NULL DEFAULT 0,
    -- Enriched by the handler when it knows them. Empty means the request never
    -- got far enough to resolve a model — itself a useful thing to see.
    provider          VARCHAR(64)  NOT NULL DEFAULT '',
    model             VARCHAR(128) NOT NULL DEFAULT '',
    -- Whether the response was streamed. A streamed and a buffered request of
    -- the same model have very different latency profiles, and averaging them
    -- together makes both unreadable.
    streaming         BOOLEAN NOT NULL DEFAULT false,
    -- The gateway's own classification of a failure, never an upstream string.
    -- Empty on success.
    error_code        VARCHAR(64)  NOT NULL DEFAULT '',
    -- Token counts when the response reported them. Zero is honest for a
    -- request that failed before the provider answered.
    prompt_tokens     BIGINT NOT NULL DEFAULT 0,
    completion_tokens BIGINT NOT NULL DEFAULT 0
);

-- The listing's default question is "the most recent requests, newest first",
-- optionally narrowed to one project. A DESC index serves both the unfiltered
-- and the project-filtered form.
CREATE INDEX IF NOT EXISTS idx_llm_request_logs_time
    ON gateway.llm_request_logs (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_request_logs_project_time
    ON gateway.llm_request_logs (project_id, occurred_at DESC);

-- "Show me the failures" is the second question every operator asks, and it is
-- the one the usage ledger could never answer. Partial, because successful
-- requests are the overwhelming majority and indexing them here would double
-- the index for rows it will never return.
CREATE INDEX IF NOT EXISTS idx_llm_request_logs_errors
    ON gateway.llm_request_logs (occurred_at DESC)
    WHERE status >= 400;
