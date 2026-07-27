-- Progress replay is intentionally bounded independently from terminal history.
-- This state preserves the monotonic worker sequence and the exact latest
-- progress receipt after older browser events have been pruned.
CREATE TABLE elitea_runtime.execution_replay_state (
    execution_id TEXT NOT NULL,
    generation BIGINT NOT NULL,
    projection_project_id INTEGER NOT NULL REFERENCES centry.project(id),
    last_node_sequence BIGINT NOT NULL DEFAULT 0,
    last_node_event_id TEXT,
    last_node_event_bytes BYTEA,
    last_node_event_digest BYTEA,
    last_node_cursor BIGINT,
    pruned_through_cursor BIGINT NOT NULL DEFAULT 0,
    retained_progress_events BIGINT NOT NULL DEFAULT 0,
    retained_progress_bytes BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (execution_id, generation),
    FOREIGN KEY (execution_id, generation)
        REFERENCES elitea_runtime.execution_jobs(execution_id, generation)
        ON DELETE CASCADE,
    CONSTRAINT execution_replay_state_sequence_nonnegative
        CHECK (last_node_sequence >= 0),
    CONSTRAINT execution_replay_state_pruned_cursor_nonnegative
        CHECK (pruned_through_cursor >= 0),
    CONSTRAINT execution_replay_state_retained_nonnegative
        CHECK (retained_progress_events >= 0 AND retained_progress_bytes >= 0),
    CONSTRAINT execution_replay_state_last_event_complete CHECK (
        (
            last_node_sequence = 0
            AND last_node_event_id IS NULL
            AND last_node_event_bytes IS NULL
            AND last_node_event_digest IS NULL
            AND last_node_cursor IS NULL
        )
        OR
        (
            last_node_sequence > 0
            AND last_node_event_id IS NOT NULL
            AND octet_length(last_node_event_bytes) BETWEEN 1 AND 65536
            AND octet_length(last_node_event_digest) = 32
            AND last_node_cursor > 0
            AND pruned_through_cursor <= last_node_cursor
        )
    )
);

WITH progress AS (
    SELECT r.execution_id,
           r.generation,
           count(*) AS retained_events,
           COALESCE(sum(octet_length(r.event_bytes)), 0) AS retained_bytes
    FROM elitea_runtime.execution_replay_events AS r
    WHERE r.event_type = 'execution.node_event'
    GROUP BY r.execution_id, r.generation
), latest AS (
    SELECT DISTINCT ON (r.execution_id, r.generation)
           r.execution_id,
           r.generation,
           r.event_id,
           r.event_bytes,
           r.event_digest,
           r.cursor
    FROM elitea_runtime.execution_replay_events AS r
    WHERE r.event_type = 'execution.node_event'
    ORDER BY r.execution_id, r.generation, r.cursor DESC
)
INSERT INTO elitea_runtime.execution_replay_state (
    execution_id,
    generation,
    projection_project_id,
    last_node_sequence,
    last_node_event_id,
    last_node_event_bytes,
    last_node_event_digest,
    last_node_cursor,
    retained_progress_events,
    retained_progress_bytes
)
SELECT j.execution_id,
       j.generation,
       j.projection_project_id,
       COALESCE(progress.retained_events, 0),
       latest.event_id,
       latest.event_bytes,
       latest.event_digest,
       latest.cursor,
       COALESCE(progress.retained_events, 0),
       COALESCE(progress.retained_bytes, 0)
FROM elitea_runtime.execution_jobs AS j
LEFT JOIN progress
  ON progress.execution_id = j.execution_id
 AND progress.generation = j.generation
LEFT JOIN latest
  ON latest.execution_id = j.execution_id
 AND latest.generation = j.generation;

CREATE INDEX execution_replay_state_project_execution_idx
    ON elitea_runtime.execution_replay_state (
        projection_project_id, execution_id, generation
    );

CREATE INDEX execution_replay_progress_expiry_idx
    ON elitea_runtime.execution_replay_events (created_at, cursor)
    INCLUDE (execution_id, generation)
    WHERE event_type = 'execution.node_event';
