//! Bounded Redis Streams intake, reclaim and PEL-ownership heartbeat.
//!
//! Redis is only the durable command-delivery plane. This owner fairly waits
//! for new commands or reclaims abandoned pending entries, and keeps every
//! queued or actively processed entry heartbeating until its processing future
//! really completes. It never acknowledges or deletes a command; the exact
//! post-settlement retirement authority remains the only such path.

#![allow(dead_code)] // The capability-disabled process serve loop is the next owner.

use std::collections::BTreeSet;
use std::future::Future;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use tokio::sync::{OwnedSemaphorePermit, Semaphore, TryAcquireError};
use tokio::time::Instant;

use crate::transport::redis_commands::RedisCommandDelivery;
use crate::transport::redis_generation::{RedisStreamsConnector, RedisStreamsHandle};
use crate::transport::redis_streams::{RedisStreamsError, RedisStreamsErrorKind};

const MAX_DELIVERY_CONCURRENCY: usize = 128;
const MAX_QUEUE_CAPACITY: usize = 512;
const MIN_BLOCK_MILLIS: u64 = 100;
const MAX_BLOCK_MILLIS: u64 = 30_000;
const MIN_RECLAIM_IDLE_MILLIS: u64 = 60_000;
const MAX_RECLAIM_IDLE_MILLIS: u64 = 86_400_000;
const MIN_RECLAIM_INTERVAL_MILLIS: u64 = 100;
const MAX_RECLAIM_INTERVAL_MILLIS: u64 = 10_000;
const INITIAL_RECLAIM_CURSOR: &str = "0-0";

/// Deployed bounds for queued, active and pending-entry ownership.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct RedisDeliveryIntakeConfig {
    max_concurrency: usize,
    queue_capacity: usize,
    read_block_millis: u64,
    reclaim_idle_millis: u64,
    reclaim_interval: Duration,
}

impl RedisDeliveryIntakeConfig {
    pub(crate) fn new(
        max_concurrency: usize,
        queue_capacity: usize,
        read_block_millis: u64,
        reclaim_idle_millis: u64,
        reclaim_interval_millis: u64,
    ) -> Result<Self, RedisStreamsError> {
        if !(1..=MAX_DELIVERY_CONCURRENCY).contains(&max_concurrency)
            || !(1..=MAX_QUEUE_CAPACITY).contains(&queue_capacity)
            || queue_capacity < max_concurrency
            || !(MIN_BLOCK_MILLIS..=MAX_BLOCK_MILLIS).contains(&read_block_millis)
            || !(MIN_RECLAIM_IDLE_MILLIS..=MAX_RECLAIM_IDLE_MILLIS).contains(&reclaim_idle_millis)
            || !(MIN_RECLAIM_INTERVAL_MILLIS..=MAX_RECLAIM_INTERVAL_MILLIS)
                .contains(&reclaim_interval_millis)
            || queue_capacity.checked_add(max_concurrency).is_none()
        {
            return Err(RedisStreamsError::configuration(
                "the Redis delivery intake limits are malformed",
            ));
        }
        Ok(Self {
            max_concurrency,
            queue_capacity,
            read_block_millis,
            reclaim_idle_millis,
            reclaim_interval: Duration::from_millis(reclaim_interval_millis),
        })
    }

    const fn ownership_capacity(self) -> usize {
        self.queue_capacity + self.max_concurrency
    }
}

type DeliveryKey = (String, String);

/// One fetched PEL entry with its exact process-local ownership slot.
///
/// The value is deliberately non-cloneable. [`Self::process`] keeps the slot
/// and heartbeat identity alive for the full processing future, including a
/// supervisor handoff, and releases both only after that future ends.
pub(crate) struct OwnedRedisDelivery {
    delivery: Option<RedisCommandDelivery>,
    key: DeliveryKey,
    owned: Arc<Mutex<BTreeSet<DeliveryKey>>>,
    _permit: OwnedSemaphorePermit,
}

impl OwnedRedisDelivery {
    #[must_use]
    pub(crate) fn stream(&self) -> &str {
        &self.key.0
    }

    #[must_use]
    pub(crate) fn entry_id(&self) -> &str {
        &self.key.1
    }

    /// Run one processing future while the PEL heartbeat and capacity slot are
    /// retained. Dropping the caller future also drops this owner, allowing a
    /// later Redis reclaim rather than acknowledging an uncertain execution.
    pub(crate) async fn process<F, Fut, T>(mut self, processor: F) -> Result<T, RedisStreamsError>
    where
        F: FnOnce(RedisCommandDelivery) -> Fut,
        Fut: Future<Output = T>,
    {
        let delivery = self.delivery.take().ok_or_else(|| {
            RedisStreamsError::protocol("the Redis delivery owner is already consumed")
        })?;
        Ok(processor(delivery).await)
    }
}

impl Drop for OwnedRedisDelivery {
    fn drop(&mut self) {
        lock_owned(&self.owned).remove(&self.key);
    }
}

/// Stateful fair intake over one replaceable Redis generation owner.
pub(crate) struct RedisDeliveryIntake<C>
where
    C: RedisStreamsConnector,
{
    handle: Arc<RedisStreamsHandle<C>>,
    config: RedisDeliveryIntakeConfig,
    capacity: Arc<Semaphore>,
    owned: Arc<Mutex<BTreeSet<DeliveryKey>>>,
    reclaim_cursor: String,
    next_reclaim: Instant,
}

impl<C> RedisDeliveryIntake<C>
where
    C: RedisStreamsConnector,
{
    #[must_use]
    pub(crate) fn new(
        handle: Arc<RedisStreamsHandle<C>>,
        config: RedisDeliveryIntakeConfig,
    ) -> Self {
        Self {
            handle,
            config,
            capacity: Arc::new(Semaphore::new(config.ownership_capacity())),
            owned: Arc::new(Mutex::new(BTreeSet::new())),
            reclaim_cursor: INITIAL_RECLAIM_CURSOR.to_owned(),
            next_reclaim: Instant::now() + config.reclaim_interval,
        }
    }

    /// Await one capacity-bounded new-read or reclaim turn.
    ///
    /// A retryable generation failure is never replayed here. The generation
    /// handle invalidates it; a later call explicitly connects a replacement
    /// before issuing a fresh operation.
    pub(crate) async fn next_batch(
        &mut self,
    ) -> Result<Vec<OwnedRedisDelivery>, RedisStreamsError> {
        self.handle.connect().await?;
        let batch_size =
            usize::try_from(self.handle.delivery_batch_size().await?).map_err(|_| {
                RedisStreamsError::resource_exhausted(
                    "the Redis delivery batch exceeds the local integer domain",
                )
            })?;
        let permits = self.reserve_capacity(batch_size).await?;
        let count = u64::try_from(permits.len()).map_err(|_| {
            RedisStreamsError::resource_exhausted(
                "the Redis delivery reservation exceeds the protocol domain",
            )
        })?;
        let now = Instant::now();
        let deliveries = if now >= self.next_reclaim {
            let result = self
                .handle
                .reclaim_page(
                    self.config.reclaim_idle_millis,
                    self.reclaim_cursor.clone(),
                    count,
                )
                .await;
            self.next_reclaim = Instant::now() + self.config.reclaim_interval;
            match result {
                Ok(page) => {
                    self.reclaim_cursor = page.next_start_id;
                    page.deliveries
                }
                Err(error) => {
                    INITIAL_RECLAIM_CURSOR.clone_into(&mut self.reclaim_cursor);
                    return Err(error);
                }
            }
        } else {
            let until_reclaim = self.next_reclaim.saturating_duration_since(now);
            let block_millis = u64::try_from(until_reclaim.as_millis())
                .map_or(u64::MAX, |millis| millis)
                .clamp(1, self.config.read_block_millis);
            self.handle.read_new(count, block_millis).await?
        };
        self.bind_deliveries(deliveries, permits)
    }

    /// Refresh every queued or active PEL entry in deterministic bounded pages.
    pub(crate) async fn heartbeat_owned(&self) -> Result<usize, RedisStreamsError> {
        let entries: Vec<String> = lock_owned(&self.owned)
            .iter()
            .map(|(_, entry_id)| entry_id.clone())
            .collect();
        if entries.is_empty() {
            return Ok(0);
        }
        self.handle.connect().await?;
        let batch_size =
            usize::try_from(self.handle.delivery_batch_size().await?).map_err(|_| {
                RedisStreamsError::resource_exhausted(
                    "the Redis heartbeat batch exceeds the local integer domain",
                )
            })?;
        if batch_size == 0 {
            return Err(RedisStreamsError::configuration(
                "the Redis heartbeat batch is empty",
            ));
        }
        let mut refreshed = 0_usize;
        for batch in entries.chunks(batch_size) {
            refreshed = refreshed
                .checked_add(
                    self.handle
                        .heartbeat_owned_pending(batch.to_vec())
                        .await?
                        .len(),
                )
                .ok_or_else(|| {
                    RedisStreamsError::resource_exhausted(
                        "the Redis heartbeat response count is exhausted",
                    )
                })?;
        }
        Ok(refreshed)
    }

    #[must_use]
    pub(crate) fn owned_count(&self) -> usize {
        lock_owned(&self.owned).len()
    }

    pub(crate) async fn close(&self) -> Result<(), RedisStreamsError> {
        self.capacity.close();
        self.handle.close().await
    }

    async fn reserve_capacity(
        &self,
        maximum: usize,
    ) -> Result<Vec<OwnedSemaphorePermit>, RedisStreamsError> {
        if maximum == 0 {
            return Err(RedisStreamsError::configuration(
                "the Redis delivery batch is empty",
            ));
        }
        let first = Arc::clone(&self.capacity)
            .acquire_owned()
            .await
            .map_err(|_| RedisStreamsError::closed())?;
        let mut permits = Vec::with_capacity(maximum);
        permits.push(first);
        while permits.len() < maximum {
            match Arc::clone(&self.capacity).try_acquire_owned() {
                Ok(permit) => permits.push(permit),
                Err(TryAcquireError::NoPermits) => break,
                Err(TryAcquireError::Closed) => return Err(RedisStreamsError::closed()),
            }
        }
        Ok(permits)
    }

    fn bind_deliveries(
        &self,
        deliveries: Vec<RedisCommandDelivery>,
        permits: Vec<OwnedSemaphorePermit>,
    ) -> Result<Vec<OwnedRedisDelivery>, RedisStreamsError> {
        if deliveries.len() > permits.len() {
            return Err(RedisStreamsError::protocol(
                "Redis returned more deliveries than the reserved capacity",
            ));
        }
        let mut owned = lock_owned(&self.owned);
        let mut permits = permits.into_iter();
        let mut accepted = Vec::with_capacity(deliveries.len());
        for delivery in deliveries {
            let permit = permits.next().ok_or_else(|| {
                RedisStreamsError::protocol(
                    "the Redis delivery reservation does not match the response",
                )
            })?;
            let key = (delivery.stream().to_owned(), delivery.entry_id().to_owned());
            if !owned.insert(key.clone()) {
                continue;
            }
            accepted.push(OwnedRedisDelivery {
                delivery: Some(delivery),
                key,
                owned: Arc::clone(&self.owned),
                _permit: permit,
            });
        }
        Ok(accepted)
    }
}

fn lock_owned(owned: &Mutex<BTreeSet<DeliveryKey>>) -> MutexGuard<'_, BTreeSet<DeliveryKey>> {
    match owned.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[must_use]
pub(crate) const fn redis_intake_failure_is_fatal(error: &RedisStreamsError) -> bool {
    !matches!(
        error.kind(),
        RedisStreamsErrorKind::DependencyUnavailable | RedisStreamsErrorKind::Timeout
    )
}
