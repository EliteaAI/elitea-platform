use std::collections::HashMap;
use std::env;
use std::str::FromStr;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use adk_rust::graph::checkpoint::RetentionPolicy;
use adk_rust::graph::{
    Checkpoint, Checkpointer, END, ExecutionConfig, NodeOutput, START, State, StateGraph,
};
use chrono::{DateTime, Utc};
use serde_json::json;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{ConnectOptions, PgPool};

use super::postgres_checkpointer::{
    APPLICATION_CAPABILITY_ID, CheckpointLimits, CheckpointWriterAuthority, PostgresCheckpointer,
};
use crate::agents::graph::{
    ParallelActivation, ParallelChildCheckpointerFactory, ParallelNodeDefinition,
};

const TEST_DATABASE_URL: &str = "ELITEA_TEST_DATABASE_URL";
const CHECKPOINT_MIGRATION: &str =
    include_str!("../../../elitea-main/migrations/shared/0064_agent_graph_checkpoints.sql");

struct IsolatedPostgres {
    pool: PgPool,
    admin_options: PgConnectOptions,
    database_name: String,
}

impl IsolatedPostgres {
    async fn create(database_url: &str) -> Self {
        let admin_options = PgConnectOptions::from_str(database_url)
            .expect("parse PostgreSQL component-test URL")
            .disable_statement_logging();
        let admin_pool = PgPoolOptions::new()
            .max_connections(2)
            .acquire_timeout(Duration::from_secs(5))
            .connect_with(admin_options.clone())
            .await
            .expect("connect PostgreSQL component-test administrator");
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let database_name = format!("elitea_rust_checkpoint_{}_{}", std::process::id(), unique);
        sqlx::query(&format!("CREATE DATABASE {database_name}"))
            .execute(&admin_pool)
            .await
            .expect("create isolated checkpoint database");
        admin_pool.close().await;

        let pool = PgPoolOptions::new()
            .min_connections(1)
            .max_connections(4)
            .acquire_timeout(Duration::from_secs(2))
            .idle_timeout(Duration::from_secs(30))
            .connect_with(admin_options.clone().database(&database_name))
            .await
            .expect("connect isolated checkpoint database");
        Self {
            pool,
            admin_options,
            database_name,
        }
    }
}

impl Drop for IsolatedPostgres {
    fn drop(&mut self) {
        let admin_options = self.admin_options.clone();
        let database_name = self.database_name.clone();
        std::thread::spawn(move || {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("build PostgreSQL cleanup runtime")
                .block_on(async move {
                    let _ = tokio::time::timeout(Duration::from_secs(10), async move {
                        if let Ok(admin_pool) = PgPoolOptions::new()
                            .max_connections(1)
                            .acquire_timeout(Duration::from_secs(5))
                            .connect_with(admin_options)
                            .await
                        {
                            let _ =
                                sqlx::query(&format!("DROP DATABASE {database_name} WITH (FORCE)"))
                                    .execute(&admin_pool)
                                    .await;
                            admin_pool.close().await;
                        }
                    })
                    .await;
                });
        })
        .join()
        .expect("join PostgreSQL cleanup thread");
    }
}

async fn install_test_schema(pool: &PgPool) {
    sqlx::raw_sql(
        r"
CREATE SCHEMA centry;
CREATE TABLE centry.project (id INTEGER PRIMARY KEY);
INSERT INTO centry.project (id) VALUES (1), (2);
CREATE SCHEMA elitea_runtime;
CREATE TABLE elitea_runtime.execution_jobs (
    execution_id TEXT NOT NULL,
    generation BIGINT NOT NULL,
    tenant_id TEXT NOT NULL,
    resource_project_id INTEGER NOT NULL REFERENCES centry.project(id),
    projection_project_id INTEGER NOT NULL REFERENCES centry.project(id),
    capability_id TEXT NOT NULL,
    invocation_state TEXT NOT NULL,
    PRIMARY KEY (execution_id, generation)
);
CREATE TABLE elitea_runtime.execution_claims (
    claim_id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    generation BIGINT NOT NULL,
    workload_session_id TEXT NOT NULL,
    producer_id TEXT NOT NULL,
    claim_attempt BIGINT NOT NULL,
    lease_epoch BIGINT NOT NULL,
    fence_token BYTEA NOT NULL,
    claimed_at TIMESTAMPTZ NOT NULL,
    lease_expires_at TIMESTAMPTZ NOT NULL,
    released_at TIMESTAMPTZ,
    FOREIGN KEY (execution_id, generation)
        REFERENCES elitea_runtime.execution_jobs(execution_id, generation)
);
        ",
    )
    .execute(pool)
    .await
    .expect("install checkpoint authority fixtures");
    sqlx::raw_sql(CHECKPOINT_MIGRATION)
        .execute(pool)
        .await
        .expect("apply checkpoint migration");
}

async fn seed_claim(
    pool: &PgPool,
    execution_id: &str,
    claim_id: &str,
    claim_attempt: i64,
    lease_epoch: i64,
    fence_token: [u8; 32],
    claimed_offset_seconds: i64,
) {
    sqlx::query(
        r"
INSERT INTO elitea_runtime.execution_jobs (
    execution_id, generation, tenant_id, resource_project_id,
    projection_project_id, capability_id, invocation_state
) VALUES ($1, 1, 'tenant-1', 1, 1, $2, 'MAY_HAVE_STARTED')
        ",
    )
    .bind(execution_id)
    .bind(APPLICATION_CAPABILITY_ID)
    .execute(pool)
    .await
    .expect("seed checkpoint execution");
    sqlx::query(
        r"
INSERT INTO elitea_runtime.execution_claims (
    claim_id, execution_id, generation, workload_session_id, producer_id,
    claim_attempt, lease_epoch, fence_token, claimed_at, lease_expires_at
) VALUES (
    $1, $2, 1, 'workload-1', 'producer-1', $3, $4, $5,
    clock_timestamp() + make_interval(secs => $6),
    clock_timestamp() + interval '5 minutes'
)
        ",
    )
    .bind(claim_id)
    .bind(execution_id)
    .bind(claim_attempt)
    .bind(lease_epoch)
    .bind(fence_token.as_slice())
    .bind(claimed_offset_seconds)
    .execute(pool)
    .await
    .expect("seed checkpoint claim");
}

async fn wait_for_blocked_query(pool: &PgPool, fragment: &str) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let blocked = sqlx::query_scalar::<_, bool>(
                r"
SELECT EXISTS (
    SELECT 1
    FROM pg_stat_activity
    WHERE pid <> pg_backend_pid()
      AND state = 'active'
      AND wait_event_type = 'Lock'
      AND position($1 in query) > 0
)
                ",
            )
            .bind(fragment)
            .fetch_one(pool)
            .await
            .expect("observe blocked PostgreSQL component query");
            if blocked {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("query reached the expected PostgreSQL lock barrier");
}

fn writer(
    execution_id: &str,
    claim_id: &str,
    claim_attempt: u64,
    lease_epoch: u64,
    definition_digest: [u8; 32],
    fence_token: [u8; 32],
) -> CheckpointWriterAuthority {
    CheckpointWriterAuthority::new(
        "tenant-1".to_owned(),
        1,
        1,
        APPLICATION_CAPABILITY_ID,
        definition_digest,
        "thread-1".to_owned(),
        execution_id.to_owned(),
        1,
        claim_id.to_owned(),
        claim_attempt,
        lease_epoch,
        "workload-1".to_owned(),
        "producer-1".to_owned(),
        fence_token,
    )
    .expect("valid checkpoint writer")
}

fn checkpoint(checkpoint_id: &str, created_at: &str, step: usize) -> Checkpoint {
    Checkpoint {
        thread_id: "thread-1".to_owned(),
        checkpoint_id: checkpoint_id.to_owned(),
        state: HashMap::from([
            (
                "messages".to_owned(),
                json!([{"role": "user", "content": "hello"}]),
            ),
            ("counter".to_owned(), json!(step)),
        ]),
        step,
        pending_nodes: vec!["review".to_owned(), "publish".to_owned()],
        metadata: HashMap::from([("route".to_owned(), json!("safe"))]),
        created_at: DateTime::parse_from_rfc3339(created_at)
            .expect("fixture timestamp")
            .with_timezone(&Utc),
        cleared_interrupt: Some("approval".to_owned()),
        attempts: HashMap::from([("review".to_owned(), 2)]),
        child_ledger: HashMap::from([("child/one".to_owned(), json!({"status": "completed"}))]),
    }
}

#[tokio::test]
#[allow(clippy::too_many_lines)] // One component story deliberately preserves lifecycle order.
async fn postgres_checkpointer_round_trips_scopes_fences_prunes_and_releases_pool() {
    let Ok(database_url) = env::var(TEST_DATABASE_URL) else {
        eprintln!("skipping PostgreSQL checkpoint component test: set {TEST_DATABASE_URL}");
        return;
    };
    let database = IsolatedPostgres::create(&database_url).await;
    install_test_schema(&database.pool).await;
    seed_claim(
        &database.pool,
        "execution-1",
        "claim-1",
        1,
        1,
        [0x61; 32],
        -10,
    )
    .await;
    let first = Arc::new(
        PostgresCheckpointer::activate(
            database.pool.clone(),
            writer("execution-1", "claim-1", 1, 1, [0x41; 32], [0x61; 32]),
            CheckpointLimits::default(),
        )
        .await
        .expect("activate first checkpoint writer"),
    );

    let first_checkpoint = checkpoint("checkpoint-z", "2026-08-13T12:34:56.123456789Z", 1);
    first
        .save(&first_checkpoint)
        .await
        .expect("save checkpoint");
    first
        .save(&first_checkpoint)
        .await
        .expect("exact save replay is idempotent");
    let restored = first
        .load("thread-1")
        .await
        .expect("load latest checkpoint")
        .expect("stored checkpoint");
    assert_eq!(restored.created_at, first_checkpoint.created_at);
    assert_eq!(restored.state, first_checkpoint.state);
    assert_eq!(restored.pending_nodes, first_checkpoint.pending_nodes);
    assert_eq!(restored.metadata, first_checkpoint.metadata);
    assert_eq!(
        restored.cleared_interrupt,
        first_checkpoint.cleared_interrupt
    );
    assert_eq!(restored.attempts, first_checkpoint.attempts);
    assert_eq!(restored.child_ledger, first_checkpoint.child_ledger);
    assert!(first.load("thread-2").await.is_err());

    let second_checkpoint = checkpoint("checkpoint-a", "2026-08-13T12:34:56.123456789Z", 2);
    first
        .save(&second_checkpoint)
        .await
        .expect("save tied checkpoint");
    assert_eq!(
        first
            .load("thread-1")
            .await
            .expect("load deterministic latest")
            .expect("latest checkpoint")
            .checkpoint_id,
        "checkpoint-a"
    );

    let mut numeric_checkpoint =
        checkpoint("checkpoint-number", "2026-08-13T12:34:56.123456790Z", 3);
    numeric_checkpoint.state.insert(
        "huge-number".to_owned(),
        serde_json::from_str("1e400").expect("arbitrary precision JSON number"),
    );
    numeric_checkpoint
        .state
        .insert("representation".to_owned(), json!(1));
    first
        .save(&numeric_checkpoint)
        .await
        .expect("save arbitrary precision checkpoint");
    assert_eq!(
        first
            .load_by_id("checkpoint-number")
            .await
            .expect("load arbitrary precision checkpoint")
            .expect("stored arbitrary precision checkpoint")
            .state,
        numeric_checkpoint.state
    );
    let mut changed_representation = numeric_checkpoint.clone();
    changed_representation
        .state
        .insert("representation".to_owned(), json!(1.0));
    assert!(first.save(&changed_representation).await.is_err());
    assert_eq!(
        first
            .list("thread-1")
            .await
            .expect("list save-ordered checkpoints")
            .into_iter()
            .map(|checkpoint| checkpoint.checkpoint_id)
            .collect::<Vec<_>>(),
        vec!["checkpoint-z", "checkpoint-a", "checkpoint-number"]
    );

    let other_definition = PostgresCheckpointer::activate(
        database.pool.clone(),
        writer("execution-1", "claim-1", 1, 1, [0x42; 32], [0x61; 32]),
        CheckpointLimits::default(),
    )
    .await
    .expect("activate isolated graph definition");
    assert!(
        other_definition
            .load_by_id("checkpoint-z")
            .await
            .expect("scoped lookup")
            .is_none()
    );

    let parallel_definition = ParallelNodeDefinition::from_yaml(
        r"
id: gather
type: parallel
branches:
  - id: short
    node: fetch_short
  - id: long
    node: fetch_long
max_concurrency: 2
wait: all
error_policy: fail_after_drain
output: [gathered]
transition: END
        ",
    )
    .expect("valid PostgreSQL parallel fixture");
    let parallel_activation = ParallelActivation {
        root_thread_id: "thread-1".to_owned(),
        node_id: parallel_definition.id().to_owned(),
        step: 4,
        config_digest: parallel_definition.config_digest(),
    };
    let short_branch = &parallel_definition.branches()[0];
    let child_input_digest = [0x42_u8; 32];
    let first_child = first
        .for_branch(&parallel_activation, short_branch, 0, &child_input_digest)
        .await
        .expect("activate first parallel child checkpoint");
    let child_runs = Arc::new(AtomicUsize::new(0));
    let first_runs = Arc::clone(&child_runs);
    let first_child_graph = StateGraph::with_channels(&["result"])
        .add_node_fn("work", move |_| {
            let first_runs = Arc::clone(&first_runs);
            async move {
                first_runs.fetch_add(1, Ordering::SeqCst);
                Ok(NodeOutput::new().with_update("result", json!({"value": "short"})))
            }
        })
        .add_edge(START, "work")
        .add_edge("work", END)
        .compile()
        .expect("compile first parallel child")
        .with_checkpointer_arc(first_child.checkpointer);
    first_child_graph
        .invoke(State::new(), ExecutionConfig::new(&first_child.thread_id))
        .await
        .expect("run first parallel child");

    let recreated_child = first
        .for_branch(&parallel_activation, short_branch, 0, &child_input_digest)
        .await
        .expect("recreate parallel child checkpoint");
    assert_eq!(recreated_child.thread_id, first_child.thread_id);
    let replay_runs = Arc::clone(&child_runs);
    let recreated_child_graph = StateGraph::with_channels(&["result"])
        .add_node_fn("work", move |_| {
            let replay_runs = Arc::clone(&replay_runs);
            async move {
                replay_runs.fetch_add(1, Ordering::SeqCst);
                Ok(NodeOutput::new().with_update("result", json!({"value": "unexpected"})))
            }
        })
        .add_edge(START, "work")
        .add_edge("work", END)
        .compile()
        .expect("compile recreated parallel child")
        .with_checkpointer_arc(recreated_child.checkpointer);
    let replayed = recreated_child_graph
        .invoke(
            State::new(),
            ExecutionConfig::new(&recreated_child.thread_id),
        )
        .await
        .expect("replay terminal parallel child");
    assert_eq!(replayed.get("result"), Some(&json!({"value": "short"})));
    assert_eq!(child_runs.load(Ordering::SeqCst), 1);

    let later_activation = ParallelActivation {
        step: parallel_activation.step + 1,
        ..parallel_activation.clone()
    };
    let later_child = first
        .for_branch(&later_activation, short_branch, 0, &child_input_digest)
        .await
        .expect("activate later loop child checkpoint");
    assert_ne!(later_child.thread_id, first_child.thread_id);
    let changed_input_child = first
        .for_branch(&parallel_activation, short_branch, 0, &[0x43_u8; 32])
        .await
        .expect("activate changed-input child checkpoint");
    assert_ne!(changed_input_child.thread_id, first_child.thread_id);

    sqlx::raw_sql(
        r"
CREATE FUNCTION block_agent_graph_checkpoint_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(640064);
    RETURN NEW;
END
$$;
CREATE TRIGGER block_agent_graph_checkpoint_insert
BEFORE INSERT ON elitea_runtime.agent_graph_checkpoints
FOR EACH ROW EXECUTE FUNCTION block_agent_graph_checkpoint_insert();
        ",
    )
    .execute(&database.pool)
    .await
    .expect("install deterministic checkpoint mutation barrier");
    let mut barrier = database
        .pool
        .begin()
        .await
        .expect("begin checkpoint mutation barrier");
    sqlx::query("SELECT pg_advisory_xact_lock(640064)")
        .execute(&mut *barrier)
        .await
        .expect("hold checkpoint mutation barrier");

    let racing_writer = Arc::clone(&first);
    let mut save_task = tokio::spawn(async move {
        racing_writer
            .save(&checkpoint(
                "checkpoint-race",
                "2026-08-13T12:34:57.123456789Z",
                4,
            ))
            .await
    });
    tokio::select! {
        result = &mut save_task => {
            panic!("checkpoint save finished before the mutation barrier: {result:?}");
        }
        () = wait_for_blocked_query(
            &database.pool,
            "INSERT INTO elitea_runtime.agent_graph_checkpoints",
        ) => {}
    }

    let release_pool = database.pool.clone();
    let mut release_task = tokio::spawn(async move {
        sqlx::query(
            r"
UPDATE elitea_runtime.execution_claims
SET released_at = clock_timestamp()
WHERE claim_id = 'claim-1' AND released_at IS NULL
            ",
        )
        .execute(&release_pool)
        .await
    });
    tokio::select! {
        result = &mut release_task => {
            panic!("claim release finished before the writer committed: {result:?}");
        }
        () = wait_for_blocked_query(
            &database.pool,
            "UPDATE elitea_runtime.execution_claims",
        ) => {}
    }
    assert!(!release_task.is_finished());

    barrier
        .commit()
        .await
        .expect("release checkpoint mutation barrier");
    tokio::time::timeout(Duration::from_secs(5), save_task)
        .await
        .expect("bounded checkpoint save race")
        .expect("checkpoint save task")
        .expect("checkpoint mutation commits before claim release");
    tokio::time::timeout(Duration::from_secs(5), release_task)
        .await
        .expect("bounded claim release race")
        .expect("claim release task")
        .expect("release claim after checkpoint transaction");
    sqlx::raw_sql(
        r"
DROP TRIGGER block_agent_graph_checkpoint_insert
    ON elitea_runtime.agent_graph_checkpoints;
DROP FUNCTION block_agent_graph_checkpoint_insert();
        ",
    )
    .execute(&database.pool)
    .await
    .expect("remove checkpoint mutation barrier");
    assert!(first.load("thread-1").await.is_err());

    seed_claim(
        &database.pool,
        "execution-2",
        "claim-2",
        2,
        2,
        [0x62; 32],
        0,
    )
    .await;
    let replacement = PostgresCheckpointer::activate(
        database.pool.clone(),
        writer("execution-2", "claim-2", 2, 2, [0x41; 32], [0x62; 32]),
        CheckpointLimits::default(),
    )
    .await
    .expect("activate replacement checkpoint writer");
    assert!(first.load("thread-1").await.is_err());
    assert_eq!(
        replacement
            .prune("thread-1", &RetentionPolicy::keep_last(1))
            .await
            .expect("prune checkpoint history"),
        3
    );
    assert_eq!(
        replacement
            .list("thread-1")
            .await
            .expect("list retained checkpoint")
            .len(),
        1
    );
    replacement
        .delete("thread-1")
        .await
        .expect("delete checkpoint history");
    assert!(
        replacement
            .list("thread-1")
            .await
            .expect("list empty thread")
            .is_empty()
    );

    let connection = database
        .pool
        .acquire()
        .await
        .expect("reuse pooled connection");
    drop(connection);
    assert!(database.pool.size() <= 4);
}
