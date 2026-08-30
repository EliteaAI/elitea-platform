use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use tokio::sync::{Barrier, Semaphore, oneshot};

use super::invocation_admission::{InvocationAdmission, InvocationAdmissionConfig};
use super::invocation_supervisor::{
    InvocationSubmissionRejected, InvocationSupervisionError, InvocationSupervisor,
    SupervisedInvocation,
};

fn admission(capacity: usize) -> InvocationAdmission {
    InvocationAdmission::new(
        InvocationAdmissionConfig::new(capacity, Duration::from_secs(1))
            .expect("valid invocation admission"),
    )
}

fn accepted<T, F>(
    result: Result<SupervisedInvocation<T>, InvocationSubmissionRejected<F>>,
) -> SupervisedInvocation<T> {
    match result {
        Ok(invocation) => invocation,
        Err(rejected) => panic!("unexpected supervision rejection: {}", rejected.error()),
    }
}

struct GatedDrop {
    entered: mpsc::SyncSender<()>,
    release: mpsc::Receiver<()>,
}

impl Drop for GatedDrop {
    fn drop(&mut self) {
        let _ignored = self.entered.send(());
        let _ignored = self.release.recv();
    }
}

#[tokio::test]
async fn dropping_a_result_waiter_cannot_cancel_owned_work_or_release_capacity_early() {
    let admission = admission(1);
    let supervisor = InvocationSupervisor::new(admission.clone());
    let reservation = admission.reserve().await.expect("reservation");
    let (started_sender, started_receiver) = oneshot::channel();
    let release = Arc::new(Semaphore::new(0));
    let operation_release = Arc::clone(&release);
    let invocation = accepted(supervisor.submit(reservation, async move {
        let _ignored = started_sender.send(());
        operation_release
            .acquire()
            .await
            .expect("release operation")
            .forget();
        42_u64
    }));
    started_receiver.await.expect("operation started");
    assert_eq!(supervisor.active_count(), 1);
    assert_eq!(admission.available_capacity(), 0);

    drop(invocation);
    assert_eq!(supervisor.active_count(), 1);
    assert_eq!(admission.available_capacity(), 0);
    release.add_permits(1);
    supervisor.close().await.expect("drain supervisor");

    assert_eq!(supervisor.active_count(), 0);
    assert_eq!(admission.available_capacity(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dropped_waiter_result_cleanup_keeps_the_reservation_until_drop_finishes() {
    let admission = admission(1);
    let supervisor = InvocationSupervisor::new(admission.clone());
    let reservation = admission.reserve().await.expect("reservation");
    let (entered_sender, entered_receiver) = mpsc::sync_channel(1);
    let (release_sender, release_receiver) = mpsc::sync_channel(1);
    let (return_sender, return_receiver) = oneshot::channel();
    let invocation = accepted(supervisor.submit(reservation, async move {
        return_receiver.await.expect("return result");
        GatedDrop {
            entered: entered_sender,
            release: release_receiver,
        }
    }));
    drop(invocation);
    return_sender.send(()).expect("release operation result");

    tokio::time::timeout(
        Duration::from_secs(1),
        tokio::task::spawn_blocking(move || entered_receiver.recv()),
    )
    .await
    .expect("result cleanup began before timeout")
    .expect("drop-observer task")
    .expect("drop signal");
    assert_eq!(supervisor.active_count(), 1);
    assert_eq!(admission.available_capacity(), 0);

    release_sender.send(()).expect("release result cleanup");
    supervisor.close().await.expect("drain supervisor");
    assert_eq!(supervisor.active_count(), 0);
    assert_eq!(admission.available_capacity(), 1);
}

#[tokio::test]
async fn close_waits_for_running_work_instead_of_aborting_it() {
    let admission = admission(1);
    let supervisor = Arc::new(InvocationSupervisor::new(admission.clone()));
    let reservation = admission.reserve().await.expect("reservation");
    let (started_sender, started_receiver) = oneshot::channel();
    let release = Arc::new(Semaphore::new(0));
    let operation_release = Arc::clone(&release);
    let completed = Arc::new(AtomicBool::new(false));
    let operation_completed = Arc::clone(&completed);
    let invocation = accepted(supervisor.submit(reservation, async move {
        let _ignored = started_sender.send(());
        operation_release
            .acquire()
            .await
            .expect("release operation")
            .forget();
        operation_completed.store(true, Ordering::Release);
        "done"
    }));
    started_receiver.await.expect("operation started");

    let closing = Arc::clone(&supervisor);
    let close = tokio::spawn(async move { closing.close().await });
    tokio::task::yield_now().await;
    assert!(!close.is_finished());
    assert!(!completed.load(Ordering::Acquire));
    release.add_permits(1);

    close.await.expect("close task").expect("drain supervisor");
    assert_eq!(invocation.wait().await.expect("invocation result"), "done");
    assert!(completed.load(Ordering::Acquire));
    assert_eq!(admission.available_capacity(), 1);
}

#[tokio::test]
async fn cancelling_one_close_waiter_does_not_cancel_the_shared_drain() {
    let admission = admission(1);
    let supervisor = Arc::new(InvocationSupervisor::new(admission.clone()));
    let reservation = admission.reserve().await.expect("reservation");
    let (started_sender, started_receiver) = oneshot::channel();
    let release = Arc::new(Semaphore::new(0));
    let operation_release = Arc::clone(&release);
    let invocation = accepted(supervisor.submit(reservation, async move {
        let _ignored = started_sender.send(());
        operation_release
            .acquire()
            .await
            .expect("release operation")
            .forget();
    }));
    started_receiver.await.expect("operation started");

    let first_supervisor = Arc::clone(&supervisor);
    let first_close = tokio::spawn(async move { first_supervisor.close().await });
    tokio::task::yield_now().await;
    first_close.abort();
    assert!(
        first_close
            .await
            .expect_err("first close was cancelled")
            .is_cancelled()
    );
    assert_eq!(supervisor.active_count(), 1);
    assert_eq!(admission.available_capacity(), 0);

    let second_supervisor = Arc::clone(&supervisor);
    let second_close = tokio::spawn(async move { second_supervisor.close().await });
    tokio::task::yield_now().await;
    assert!(!second_close.is_finished());
    release.add_permits(1);
    second_close
        .await
        .expect("second close task")
        .expect("shared drain");
    invocation.wait().await.expect("invocation result");
    assert_eq!(supervisor.active_count(), 0);
    assert_eq!(admission.available_capacity(), 1);
}

#[tokio::test]
async fn a_reservation_from_another_pool_is_rejected_before_polling() {
    let owned = admission(1);
    let foreign = admission(1);
    let supervisor = InvocationSupervisor::new(owned);
    let reservation = foreign.reserve().await.expect("foreign reservation");
    let polled = Arc::new(AtomicBool::new(false));
    let operation_polled = Arc::clone(&polled);

    let Err(rejected) = supervisor.submit(reservation, async move {
        operation_polled.store(true, Ordering::Release);
    }) else {
        panic!("foreign reservation must fail");
    };

    assert_eq!(
        rejected.error(),
        InvocationSupervisionError::InvalidReservation(
            "the invocation reservation belongs to another admission pool"
        )
    );
    let (error, reservation, operation) = rejected.into_parts();
    assert_eq!(error.code(), "invocation_supervision.invalid_reservation");
    assert!(!polled.load(Ordering::Acquire));
    assert_eq!(foreign.available_capacity(), 0);
    drop(operation);
    drop(reservation);
    assert_eq!(foreign.available_capacity(), 1);
    supervisor.close().await.expect("close supervisor");
}

#[tokio::test]
async fn stop_wakes_admission_and_returns_a_preexisting_reservation_with_its_operation() {
    let admission = admission(1);
    let supervisor = InvocationSupervisor::new(admission.clone());
    let reservation = admission.reserve().await.expect("reservation");
    let waiting_admission = admission.clone();
    let waiter = tokio::spawn(async move { waiting_admission.reserve().await });
    tokio::task::yield_now().await;

    supervisor.stop().expect("stop supervisor");
    let Err(wait_error) = waiter.await.expect("waiter task") else {
        panic!("draining admission must not grant a reservation");
    };
    assert!(matches!(
        wait_error,
        super::invocation_admission::InvocationAdmissionError::Draining(_)
    ));

    let polled = Arc::new(AtomicBool::new(false));
    let operation_polled = Arc::clone(&polled);
    let Err(rejected) = supervisor.submit(reservation, async move {
        operation_polled.store(true, Ordering::Release);
    }) else {
        panic!("stopped supervisor must return the submission");
    };
    assert!(matches!(
        rejected.error(),
        InvocationSupervisionError::Closed(_)
    ));
    let (_, reservation, operation) = rejected.into_parts();
    assert_eq!(admission.available_capacity(), 0);
    assert!(!polled.load(Ordering::Acquire));
    operation.await;
    assert!(polled.load(Ordering::Acquire));
    drop(reservation);
    assert_eq!(admission.available_capacity(), 1);
    supervisor.close().await.expect("close supervisor");
}

#[tokio::test]
async fn concurrent_stop_and_submit_either_supervises_or_returns_all_authority() {
    let admission = admission(1);
    let supervisor = Arc::new(InvocationSupervisor::new(admission.clone()));
    let reservation = admission.reserve().await.expect("reservation");
    let barrier = Arc::new(Barrier::new(2));
    let executions = Arc::new(AtomicUsize::new(0));

    let submitting_supervisor = Arc::clone(&supervisor);
    let submitting_barrier = Arc::clone(&barrier);
    let operation_executions = Arc::clone(&executions);
    let submit = tokio::spawn(async move {
        submitting_barrier.wait().await;
        match submitting_supervisor.submit(reservation, async move {
            operation_executions.fetch_add(1, Ordering::AcqRel);
        }) {
            Ok(invocation) => invocation.wait().await.expect("supervised result"),
            Err(rejected) => {
                let (_, reservation, operation) = rejected.into_parts();
                operation.await;
                drop(reservation);
            }
        }
    });
    let stopping_supervisor = Arc::clone(&supervisor);
    let stop = tokio::spawn(async move {
        barrier.wait().await;
        stopping_supervisor.stop()
    });

    stop.await.expect("stop task").expect("stop supervisor");
    submit.await.expect("submit task");
    supervisor.close().await.expect("close supervisor");
    assert_eq!(executions.load(Ordering::Acquire), 1);
    assert_eq!(admission.available_capacity(), 1);
}

#[tokio::test]
async fn a_panicking_operation_is_contained_and_releases_its_reservation() {
    crate::diagnostics::install_redacted_panic_hook();
    let admission = admission(1);
    let supervisor = InvocationSupervisor::new(admission.clone());
    let reservation = admission.reserve().await.expect("reservation");
    let invocation: SupervisedInvocation<()> =
        accepted(supervisor.submit(reservation, async move {
            panic!("SECRET_FIXTURE_PANIC_PAYLOAD");
        }));

    assert!(matches!(
        invocation.wait().await,
        Err(InvocationSupervisionError::TaskLost(_))
    ));
    supervisor.close().await.expect("close supervisor");
    assert_eq!(admission.available_capacity(), 1);
}
