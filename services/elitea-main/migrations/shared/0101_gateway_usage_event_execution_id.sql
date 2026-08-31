-- 0101_gateway_usage_event_execution_id.sql
--
-- The AGENT dimension for gateway.llm_usage_events (0084).
--
-- ## Which history, and why it is a SECOND file rather than part of 0100
--
-- SHARED, for the reason 0100 gives: `gateway` is one schema in the shared
-- database and the tenant history would run this ALTER once per project.
--
-- It is a separate file because the two tables have separate WRITERS and
-- therefore separate deployment risk. gateway.llm_request_logs is written by
-- the gateway in process; gateway.llm_usage_events is written by the
-- SCHEDULER's write-back consumer and, during a NATS outage, by the gateway's
-- own failmode store. Splitting them means a deployment can carry the log's
-- column without the ledger's, and a rollback of one does not take the other —
-- and, since a migration's checksum is immutable once applied, a combined file
-- could not be split later.
--
-- ## Why the ledger needs the column too, given 0100
--
-- The two tables answer different questions and 0099's header says so: the log
-- holds EVERY request, billed or not, and the ledger holds only BILLED ones,
-- with the money. "Which agent ran, how often, how slowly" comes from the log.
-- "What did that agent SPEND" can only come from the ledger, because the log
-- has no cost column — deliberately, so there is one money path and not two.
-- Without this column the per-agent view could report volume and would have to
-- refuse spend.
--
-- ## The value travels; it is not derived
--
-- The gateway puts the execution id on the billing delta it publishes
-- (usageDimsPayload, `execution_id`, omitempty), and the scheduler's write-back
-- consumer writes it into this column in the SAME transaction as the
-- accumulator UPSERT. The outage-window writer in the gateway's failmode store
-- writes the identical shape. Both remain ON CONFLICT (event_id) DO NOTHING, so
-- the two writers still produce one row.
--
-- An OLDER consumer simply ignores the new JSON key, so a gateway that emits it
-- before the scheduler that reads it leaves this column NULL rather than
-- failing a delta. That is why the wire field is omitempty and why this column
-- is nullable.
--
-- ## Nullable, and NOT backfilled — same as 0100
--
-- NULL means "not made from a runtime execution" and also "written before this
-- migration", and nothing distinguishes the two. There is no backfill: no row
-- already in this table identifies an agent, and inventing one would be worse
-- than the gap. The read side reports availability and omits the breakdown, the
-- way usageDimensions.Available already does for a deployment upgraded
-- mid-period; it never zero-fills.
--
-- IDEMPOTENCE, as in 0084 and 0099: every statement is guarded.
--
-- No BEGIN/COMMIT: the ledgered runner wraps each file in one transaction with
-- its ledger row (migrate/runner.go apply).

ALTER TABLE gateway.llm_usage_events
    ADD COLUMN IF NOT EXISTS execution_id VARCHAR(128);

-- The per-agent spend read asks "every billed event for THIS project in this
-- window", the same shape as 0084's idx_llm_usage_events_project_time. DESC
-- here rather than 0084's ASC because this read is the analytics window's
-- newest-first one, and it is partial for the reason 0100's is: an attributable
-- event is the minority of billed events.
CREATE INDEX IF NOT EXISTS idx_llm_usage_events_execution_project_time
    ON gateway.llm_usage_events (project_id, occurred_at DESC)
    WHERE execution_id IS NOT NULL;
