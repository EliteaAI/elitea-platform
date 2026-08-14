use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::Notify;

use super::redis_delivery::{
    RedisDeliveryIntake, RedisDeliveryIntakeConfig, redis_intake_failure_is_fatal,
};
use crate::transport::redis_commands::{
    RedisCommandDelivery, RedisCommandLimits, RedisRetirementClient, RedisRetirementClientError,
    RedisRetirementRequest, RedisRetirementResponse,
};
use crate::transport::redis_generation::{
    RedisGenerationFuture, RedisStreamsConnection, RedisStreamsConnector, RedisStreamsHandle,
};
use crate::transport::redis_streams::{RedisReclaimPage, RedisStreamsError, RedisStreamsErrorKind};

#[derive(Debug, Eq, PartialEq)]
enum FakeOperation {
    Read {
        count: u64,
        block_millis: u64,
    },
    Reclaim {
        min_idle_millis: u64,
        start_id: String,
        count: u64,
    },
    Heartbeat(Vec<String>),
    Close,
}

struct FakeConnection {
    batch_size: u64,
    reads: Mutex<VecDeque<Result<Vec<RedisCommandDelivery>, RedisStreamsError>>>,
    reclaims: Mutex<VecDeque<Result<RedisReclaimPage, RedisStreamsError>>>,
    heartbeats: Mutex<VecDeque<Result<Vec<String>, RedisStreamsError>>>,
    operations: Mutex<Vec<FakeOperation>>,
}

impl FakeConnection {
    fn new(batch_size: u64) -> Self {
        Self {
            batch_size,
            reads: Mutex::new(VecDeque::new()),
            reclaims: Mutex::new(VecDeque::new()),
            heartbeats: Mutex::new(VecDeque::new()),
            operations: Mutex::new(Vec::new()),
        }
    }

    fn push_read(&self, value: Result<Vec<RedisCommandDelivery>, RedisStreamsError>) {
        self.reads.lock().expect("read queue").push_back(value);
    }

    fn push_reclaim(&self, value: Result<RedisReclaimPage, RedisStreamsError>) {
        self.reclaims
            .lock()
            .expect("reclaim queue")
            .push_back(value);
    }

    fn push_heartbeat(&self, value: Result<Vec<String>, RedisStreamsError>) {
        self.heartbeats
            .lock()
            .expect("heartbeat queue")
            .push_back(value);
    }

    fn operations(&self) -> Vec<FakeOperation> {
        self.operations
            .lock()
            .expect("operation log")
            .iter()
            .map(|operation| match operation {
                FakeOperation::Read {
                    count,
                    block_millis,
                } => FakeOperation::Read {
                    count: *count,
                    block_millis: *block_millis,
                },
                FakeOperation::Reclaim {
                    min_idle_millis,
                    start_id,
                    count,
                } => FakeOperation::Reclaim {
                    min_idle_millis: *min_idle_millis,
                    start_id: start_id.clone(),
                    count: *count,
                },
                FakeOperation::Heartbeat(entries) => FakeOperation::Heartbeat(entries.clone()),
                FakeOperation::Close => FakeOperation::Close,
            })
            .collect()
    }
}

#[async_trait]
impl RedisRetirementClient for FakeConnection {
    async fn retire_delivery(
        &self,
        _request: RedisRetirementRequest,
    ) -> Result<RedisRetirementResponse, RedisRetirementClientError> {
        Ok(RedisRetirementResponse {
            acknowledged: 1,
            deleted: 1,
            unmapped: 1,
        })
    }
}

impl RedisStreamsConnection for FakeConnection {
    fn delivery_batch_size(&self) -> u64 {
        self.batch_size
    }

    fn read_new(
        self: Arc<Self>,
        count: u64,
        block_millis: u64,
    ) -> RedisGenerationFuture<Result<Vec<RedisCommandDelivery>, RedisStreamsError>> {
        Box::pin(async move {
            self.operations
                .lock()
                .expect("operation log")
                .push(FakeOperation::Read {
                    count,
                    block_millis,
                });
            self.reads
                .lock()
                .expect("read queue")
                .pop_front()
                .unwrap_or_else(|| Ok(Vec::new()))
        })
    }

    fn reclaim_page(
        self: Arc<Self>,
        min_idle_millis: u64,
        start_id: String,
        count: u64,
    ) -> RedisGenerationFuture<Result<RedisReclaimPage, RedisStreamsError>> {
        Box::pin(async move {
            self.operations
                .lock()
                .expect("operation log")
                .push(FakeOperation::Reclaim {
                    min_idle_millis,
                    start_id: start_id.clone(),
                    count,
                });
            self.reclaims
                .lock()
                .expect("reclaim queue")
                .pop_front()
                .unwrap_or_else(|| {
                    Ok(RedisReclaimPage {
                        next_start_id: start_id,
                        deliveries: Vec::new(),
                    })
                })
        })
    }

    fn heartbeat_owned_pending(
        self: Arc<Self>,
        entry_ids: Vec<String>,
    ) -> RedisGenerationFuture<Result<Vec<String>, RedisStreamsError>> {
        Box::pin(async move {
            self.operations
                .lock()
                .expect("operation log")
                .push(FakeOperation::Heartbeat(entry_ids.clone()));
            self.heartbeats
                .lock()
                .expect("heartbeat queue")
                .pop_front()
                .unwrap_or(Ok(entry_ids))
        })
    }

    fn close(self: Arc<Self>) -> RedisGenerationFuture<Result<(), RedisStreamsError>> {
        Box::pin(async move {
            self.operations
                .lock()
                .expect("operation log")
                .push(FakeOperation::Close);
            Ok(())
        })
    }
}

struct FakeConnector {
    connections: Mutex<VecDeque<Arc<FakeConnection>>>,
}

impl FakeConnector {
    fn new(connections: impl IntoIterator<Item = Arc<FakeConnection>>) -> Self {
        Self {
            connections: Mutex::new(connections.into_iter().collect()),
        }
    }
}

impl RedisStreamsConnector for FakeConnector {
    type Connection = FakeConnection;

    fn connect(
        self: Arc<Self>,
    ) -> RedisGenerationFuture<Result<Arc<Self::Connection>, RedisStreamsError>> {
        Box::pin(async move {
            self.connections
                .lock()
                .expect("connection queue")
                .pop_front()
                .ok_or_else(|| {
                    RedisStreamsError::unavailable("the fake Redis connector is exhausted")
                })
        })
    }
}

fn config(max_concurrency: usize, queue_capacity: usize) -> RedisDeliveryIntakeConfig {
    RedisDeliveryIntakeConfig::new(max_concurrency, queue_capacity, 30_000, 60_000, 100)
        .expect("valid intake config")
}

fn delivery(entry_id: &str) -> RedisCommandDelivery {
    RedisCommandDelivery::decode(
        b"commands",
        entry_id.as_bytes(),
        [(b"signed_envelope".to_vec(), b"signed-command".to_vec())],
        RedisCommandLimits {
            max_entry_bytes: 64 * 1024,
            max_field_bytes: 48 * 1024,
        },
    )
    .expect("valid delivery fixture")
}

fn intake(
    connection: Arc<FakeConnection>,
    config: RedisDeliveryIntakeConfig,
) -> RedisDeliveryIntake<FakeConnector> {
    let connector = Arc::new(FakeConnector::new([connection]));
    let handle = Arc::new(RedisStreamsHandle::new(connector));
    RedisDeliveryIntake::new(handle, config)
}

#[tokio::test(start_paused = true)]
async fn intake_alternates_a_bounded_read_with_the_due_reclaim_turn() {
    let connection = Arc::new(FakeConnection::new(2));
    connection.push_read(Ok(vec![delivery("1-0")]));
    connection.push_reclaim(Ok(RedisReclaimPage {
        next_start_id: "7-0".to_owned(),
        deliveries: vec![delivery("2-0")],
    }));
    let mut intake = intake(Arc::clone(&connection), config(1, 1));

    let first = intake.next_batch().await.expect("bounded new read");
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].entry_id(), "1-0");
    drop(first);

    tokio::time::advance(Duration::from_millis(100)).await;
    let reclaimed = intake.next_batch().await.expect("due reclaim turn");
    assert_eq!(reclaimed.len(), 1);
    assert_eq!(reclaimed[0].entry_id(), "2-0");

    let operations = connection.operations();
    assert!(matches!(
        operations.as_slice(),
        [
            FakeOperation::Read {
                count: 2,
                block_millis: 1..=100
            },
            FakeOperation::Reclaim {
                min_idle_millis: 60_000,
                start_id,
                count: 2
            }
        ] if start_id == "0-0"
    ));
}

#[tokio::test(start_paused = true)]
async fn an_owned_pending_entry_is_not_locally_admitted_twice() {
    let connection = Arc::new(FakeConnection::new(2));
    connection.push_read(Ok(vec![delivery("1-0")]));
    connection.push_reclaim(Ok(RedisReclaimPage {
        next_start_id: "0-0".to_owned(),
        deliveries: vec![delivery("1-0")],
    }));
    connection.push_reclaim(Ok(RedisReclaimPage {
        next_start_id: "0-0".to_owned(),
        deliveries: vec![delivery("1-0")],
    }));
    let mut intake = intake(Arc::clone(&connection), config(1, 1));

    let first = intake.next_batch().await.expect("first delivery");
    assert_eq!(intake.owned_count(), 1);
    tokio::time::advance(Duration::from_millis(100)).await;
    assert!(
        intake
            .next_batch()
            .await
            .expect("duplicate reclaim")
            .is_empty()
    );
    assert_eq!(intake.owned_count(), 1);

    drop(first);
    assert_eq!(intake.owned_count(), 0);
    tokio::time::advance(Duration::from_millis(100)).await;
    let accepted_again = intake.next_batch().await.expect("later reclaim");
    assert_eq!(accepted_again.len(), 1);
}

#[tokio::test]
async fn ownership_capacity_is_retained_until_the_delivery_owner_drops() {
    let connection = Arc::new(FakeConnection::new(2));
    connection.push_read(Ok(vec![delivery("1-0"), delivery("2-0")]));
    connection.push_read(Ok(vec![delivery("3-0")]));
    let intake = intake(connection, config(1, 1));
    let mut intake = intake;
    let first = intake.next_batch().await.expect("capacity-filling batch");
    assert_eq!(first.len(), 2);

    let waiting = tokio::spawn(async move {
        let result = intake.next_batch().await;
        (intake, result)
    });
    tokio::task::yield_now().await;
    assert!(!waiting.is_finished());

    drop(first);
    let (intake, next) = waiting.await.expect("waiting intake task");
    let next = next.expect("next admitted batch");
    assert_eq!(next.len(), 1);
    assert_eq!(intake.owned_count(), 1);
}

#[tokio::test]
async fn processing_retains_heartbeat_identity_until_the_future_really_finishes() {
    let connection = Arc::new(FakeConnection::new(2));
    connection.push_read(Ok(vec![delivery("2-0"), delivery("1-0")]));
    connection.push_heartbeat(Ok(vec!["1-0".to_owned(), "2-0".to_owned()]));
    let mut intake = intake(Arc::clone(&connection), config(1, 1));
    let mut batch = intake.next_batch().await.expect("owned deliveries");
    let processing = batch.pop().expect("processing delivery");
    let queued = batch.pop().expect("queued delivery");
    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let process_started = Arc::clone(&started);
    let process_release = Arc::clone(&release);
    let task = tokio::spawn(async move {
        processing
            .process(|_delivery| async move {
                process_started.notify_one();
                process_release.notified().await;
                7_u8
            })
            .await
    });
    started.notified().await;

    assert_eq!(intake.heartbeat_owned().await.expect("PEL heartbeat"), 2);
    assert!(matches!(
        connection.operations().last(),
        Some(FakeOperation::Heartbeat(entries))
            if entries == &["1-0".to_owned(), "2-0".to_owned()]
    ));
    assert_eq!(intake.owned_count(), 2);

    drop(queued);
    release.notify_one();
    assert_eq!(task.await.expect("processing task").expect("processing"), 7);
    assert_eq!(intake.owned_count(), 0);
}

#[tokio::test]
async fn retryable_generation_failure_is_not_replayed_and_next_turn_reconnects() {
    let first = Arc::new(FakeConnection::new(1));
    first.push_read(Err(RedisStreamsError::unavailable(
        "the first fake generation is unavailable",
    )));
    let second = Arc::new(FakeConnection::new(1));
    second.push_read(Ok(vec![delivery("9-0")]));
    let connector = Arc::new(FakeConnector::new([
        Arc::clone(&first),
        Arc::clone(&second),
    ]));
    let handle = Arc::new(RedisStreamsHandle::new(connector));
    let mut intake = RedisDeliveryIntake::new(handle, config(1, 1));

    let error = intake.next_batch().await.err().expect("first read fails");
    assert_eq!(error.kind(), RedisStreamsErrorKind::DependencyUnavailable);
    assert!(!redis_intake_failure_is_fatal(&error));
    assert_eq!(first.operations().len(), 1);

    let next = intake.next_batch().await.expect("explicit next turn");
    assert_eq!(next.len(), 1);
    assert_eq!(second.operations().len(), 1);
    assert!(redis_intake_failure_is_fatal(&RedisStreamsError::protocol(
        "malformed Redis response"
    )));
}

#[test]
fn deployed_intake_bounds_fail_closed() {
    assert!(RedisDeliveryIntakeConfig::new(1, 1, 100, 60_000, 100).is_ok());
    assert!(RedisDeliveryIntakeConfig::new(128, 512, 30_000, 86_400_000, 10_000).is_ok());
    assert!(RedisDeliveryIntakeConfig::new(0, 1, 100, 60_000, 100).is_err());
    assert!(RedisDeliveryIntakeConfig::new(2, 1, 100, 60_000, 100).is_err());
    assert!(RedisDeliveryIntakeConfig::new(1, 513, 100, 60_000, 100).is_err());
    assert!(RedisDeliveryIntakeConfig::new(1, 1, 99, 60_000, 100).is_err());
    assert!(RedisDeliveryIntakeConfig::new(1, 1, 100, 59_999, 100).is_err());
    assert!(RedisDeliveryIntakeConfig::new(1, 1, 100, 60_000, 99).is_err());
}
