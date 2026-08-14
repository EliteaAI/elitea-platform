//! Cancellation-safe ownership for admitted native agent work.
//!
//! Submission is synchronous once an invocation reservation exists: there is
//! no await point at which caller cancellation can lose an authorized job. A
//! dropped waiter abandons only its result receiver. The supervisor continues
//! to own the task and its reservation until the real future exits, and an
//! explicit close stops the exact admission pool before draining every task.

#![allow(dead_code)] // Wired by the next authorized invocation coordinator slice.

use std::fmt;
use std::future::Future;
use std::mem;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use tokio::runtime::Handle;
use tokio::sync::{oneshot, watch};
use tokio::task::JoinHandle;

use super::invocation_admission::{InvocationAdmission, InvocationReservation};

struct SupervisorState {
    accepting: bool,
    drain_started: bool,
    tasks: Vec<JoinHandle<()>>,
}

struct InvocationSupervisorInner {
    admission: InvocationAdmission,
    state: Mutex<SupervisorState>,
    completed: watch::Sender<bool>,
    completion: watch::Receiver<bool>,
    active: Arc<AtomicUsize>,
}

/// Process-owned task group for already-admitted native invocations.
///
/// The registry cannot grow with arbitrary caller input: every task consumes
/// a non-cloneable reservation from the exact admission pool attached at
/// construction, whose deployment capacity is capped at 4,096. Completed
/// handles are pruned on each later submission.
pub(super) struct InvocationSupervisor {
    inner: Arc<InvocationSupervisorInner>,
}

impl InvocationSupervisor {
    pub(super) fn new(admission: InvocationAdmission) -> Self {
        let (completed, completion) = watch::channel(false);
        Self {
            inner: Arc::new(InvocationSupervisorInner {
                admission,
                state: Mutex::new(SupervisorState {
                    accepting: true,
                    drain_started: false,
                    tasks: Vec::new(),
                }),
                completed,
                completion,
                active: Arc::new(AtomicUsize::new(0)),
            }),
        }
    }

    /// Atomically transfer one admitted operation to process-owned supervision.
    ///
    /// Returning success proves the runtime owns both the future and its
    /// capacity reservation before a caller can begin awaiting or drop the
    /// result handle. Every rejection returns both values to the caller; an
    /// authorization or lease authority captured by the future is never
    /// silently destroyed by a shutdown race.
    pub(super) fn submit<T, F>(
        &self,
        reservation: InvocationReservation,
        operation: F,
    ) -> Result<SupervisedInvocation<T>, InvocationSubmissionRejected<F>>
    where
        T: Send + 'static,
        F: Future<Output = T> + Send + 'static,
    {
        if !self.inner.admission.owns(&reservation) {
            return Err(rejected(
                InvocationSupervisionError::InvalidReservation(
                    "the invocation reservation belongs to another admission pool",
                ),
                reservation,
                operation,
            ));
        }
        let Ok(runtime) = Handle::try_current() else {
            return Err(rejected(
                InvocationSupervisionError::Unavailable(
                    "the invocation supervisor requires an active Tokio runtime",
                ),
                reservation,
                operation,
            ));
        };
        let Ok(mut state) = self.inner.state.lock() else {
            return Err(rejected(
                InvocationSupervisionError::Unavailable(
                    "the invocation supervisor state is unavailable",
                ),
                reservation,
                operation,
            ));
        };
        if !state.accepting {
            return Err(rejected(
                InvocationSupervisionError::Closed(
                    "the invocation supervisor is no longer accepting work",
                ),
                reservation,
                operation,
            ));
        }

        state.tasks.retain(|task| !task.is_finished());
        let (result_sender, result_receiver) = oneshot::channel();
        let active = ActiveInvocation::new(Arc::clone(&self.inner.active));
        state.tasks.push(runtime.spawn(async move {
            let _active = active;
            let result = operation.await;
            if let Err(unreceived) = result_sender.send(result) {
                drop(unreceived);
            }
            drop(reservation);
        }));
        Ok(SupervisedInvocation {
            result: result_receiver,
        })
    }

    #[must_use]
    pub(super) fn active_count(&self) -> usize {
        self.inner.active.load(Ordering::Acquire)
    }

    /// Stop the exact admission pool and reject later task transfers without
    /// cancelling accepted work or consuming a rejected caller's authority.
    pub(super) fn stop(&self) -> Result<(), InvocationSupervisionError> {
        let Ok(mut state) = self.inner.state.lock() else {
            self.inner.admission.stop();
            return Err(InvocationSupervisionError::Unavailable(
                "the invocation supervisor state is unavailable",
            ));
        };
        state.accepting = false;
        self.inner.admission.stop();
        Ok(())
    }

    /// Stop submission and cancellation-safely wait for every accepted task.
    ///
    /// The first caller starts a detached drain owner before awaiting. Dropping
    /// any `close` future therefore abandons only that wait; another caller can
    /// still observe the same completion signal.
    pub(super) async fn close(&self) -> Result<(), InvocationSupervisionError> {
        self.stop()?;
        {
            let mut state = self.inner.state.lock().map_err(|_| {
                InvocationSupervisionError::Unavailable(
                    "the invocation supervisor state is unavailable",
                )
            })?;
            if !state.drain_started {
                state.drain_started = true;
                let tasks = mem::take(&mut state.tasks);
                let completed = self.inner.completed.clone();
                tokio::spawn(async move {
                    for task in tasks {
                        let _ignored = task.await;
                    }
                    let _ignored = completed.send(true);
                });
            }
        }

        let mut completion = self.inner.completion.clone();
        while !*completion.borrow() {
            completion.changed().await.map_err(|_| {
                InvocationSupervisionError::Unavailable(
                    "the invocation supervisor completion signal is unavailable",
                )
            })?;
        }
        Ok(())
    }
}

/// A result wait that carries no cancellation authority over the real task.
pub(super) struct SupervisedInvocation<T> {
    result: oneshot::Receiver<T>,
}

impl<T> SupervisedInvocation<T> {
    pub(super) async fn wait(self) -> Result<T, InvocationSupervisionError> {
        self.result.await.map_err(|_| {
            InvocationSupervisionError::TaskLost("the supervised invocation ended without a result")
        })
    }
}

/// Rejected ownership transfer with the original authority-bearing values.
///
/// This type intentionally implements neither `Clone` nor `Debug` because the
/// future may contain claim, workload, tool, or model material.
pub(super) struct InvocationSubmissionRejected<F> {
    error: InvocationSupervisionError,
    reservation: InvocationReservation,
    operation: F,
}

impl<F> InvocationSubmissionRejected<F> {
    #[must_use]
    pub(super) const fn error(&self) -> InvocationSupervisionError {
        self.error
    }

    #[must_use]
    pub(super) fn into_parts(self) -> (InvocationSupervisionError, InvocationReservation, F) {
        (self.error, self.reservation, self.operation)
    }
}

/// Stable, data-free task ownership failures.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum InvocationSupervisionError {
    InvalidReservation(&'static str),
    Closed(&'static str),
    TaskLost(&'static str),
    Unavailable(&'static str),
}

impl InvocationSupervisionError {
    #[must_use]
    pub(super) const fn code(self) -> &'static str {
        match self {
            Self::InvalidReservation(_) => "invocation_supervision.invalid_reservation",
            Self::Closed(_) => "invocation_supervision.closed",
            Self::TaskLost(_) => "invocation_supervision.task_lost",
            Self::Unavailable(_) => "invocation_supervision.unavailable",
        }
    }
}

impl fmt::Display for InvocationSupervisionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidReservation(message)
            | Self::Closed(message)
            | Self::TaskLost(message)
            | Self::Unavailable(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for InvocationSupervisionError {}

fn rejected<F>(
    error: InvocationSupervisionError,
    reservation: InvocationReservation,
    operation: F,
) -> InvocationSubmissionRejected<F> {
    InvocationSubmissionRejected {
        error,
        reservation,
        operation,
    }
}

struct ActiveInvocation {
    active: Arc<AtomicUsize>,
}

impl ActiveInvocation {
    fn new(active: Arc<AtomicUsize>) -> Self {
        active.fetch_add(1, Ordering::AcqRel);
        Self { active }
    }
}

impl Drop for ActiveInvocation {
    fn drop(&mut self) {
        self.active.fetch_sub(1, Ordering::AcqRel);
    }
}
