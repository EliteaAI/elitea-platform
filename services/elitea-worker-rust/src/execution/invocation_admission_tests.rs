use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Barrier;
use tokio::time::{advance, timeout};

use super::invocation_admission::{
    InvocationAdmission, InvocationAdmissionConfig, InvocationAdmissionErrorCode,
};

fn admission(capacity: usize, wait_timeout: Duration) -> InvocationAdmission {
    InvocationAdmission::new(
        InvocationAdmissionConfig::new(capacity, wait_timeout).expect("valid admission policy"),
    )
}

#[test]
fn configuration_bounds_are_exact_and_descriptive() {
    assert!(InvocationAdmissionConfig::new(1, Duration::from_nanos(1)).is_ok());
    assert!(InvocationAdmissionConfig::new(4_096, Duration::from_mins(5)).is_ok());
    for invalid in [
        InvocationAdmissionConfig::new(0, Duration::from_secs(1)),
        InvocationAdmissionConfig::new(4_097, Duration::from_secs(1)),
        InvocationAdmissionConfig::new(1, Duration::ZERO),
        InvocationAdmissionConfig::new(1, Duration::from_mins(5) + Duration::from_nanos(1)),
    ] {
        let error = invalid.expect_err("invalid admission policy");
        assert_eq!(
            error.code().as_str(),
            "invocation_admission_invalid_configuration"
        );
        assert!(!error.retryable());
        assert_eq!(
            error.to_string(),
            "the invocation admission limits are outside the approved range"
        );
    }
}

#[tokio::test(flavor = "current_thread")]
async fn reservation_bounds_running_plus_queued_work_and_releases_on_drop() {
    let admission = admission(2, Duration::from_secs(1));
    assert_eq!(admission.configured_capacity(), 2);
    let first = admission.reserve().await.expect("first slot");
    let second = admission.reserve().await.expect("second slot");
    assert_eq!(admission.available_capacity(), 0);

    drop(first);
    assert_eq!(admission.available_capacity(), 1);
    let replacement = admission.reserve().await.expect("replacement slot");
    assert_eq!(admission.available_capacity(), 0);
    drop((second, replacement));
    assert_eq!(admission.available_capacity(), 2);
}

#[tokio::test(flavor = "current_thread", start_paused = true)]
async fn saturation_timeout_is_retryable_and_does_not_leak_capacity() {
    let admission = admission(1, Duration::from_millis(50));
    let held = admission.reserve().await.expect("held slot");
    let waiter = tokio::spawn({
        let admission = admission.clone();
        async move { admission.reserve().await }
    });
    advance(Duration::from_millis(50)).await;
    let Err(error) = waiter.await.expect("waiter task") else {
        panic!("saturated admission must not mint a reservation")
    };
    assert_eq!(error.code(), InvocationAdmissionErrorCode::Saturated);
    assert!(error.retryable());
    assert_eq!(admission.available_capacity(), 0);
    drop(held);
    assert_eq!(admission.available_capacity(), 1);
}

#[tokio::test(flavor = "current_thread")]
async fn cancelling_a_waiter_withdraws_it_without_stealing_the_next_slot() {
    let admission = admission(1, Duration::from_secs(10));
    let held = admission.reserve().await.expect("held slot");
    let cancelled = tokio::spawn({
        let admission = admission.clone();
        async move { admission.reserve().await }
    });
    tokio::task::yield_now().await;
    cancelled.abort();
    let Err(join_error) = cancelled.await else {
        panic!("aborted waiter must not return a reservation")
    };
    assert!(join_error.is_cancelled());

    drop(held);
    let next = timeout(Duration::from_secs(1), admission.reserve())
        .await
        .expect("next waiter is bounded")
        .expect("next slot");
    drop(next);
    assert_eq!(admission.available_capacity(), 1);
}

#[tokio::test(flavor = "current_thread")]
async fn stop_wakes_waiters_and_preserves_existing_reservation_ownership() {
    let admission = admission(1, Duration::from_secs(10));
    let held = admission.reserve().await.expect("held slot");
    let entered = Arc::new(Barrier::new(2));
    let waiter = tokio::spawn({
        let admission = admission.clone();
        let entered = Arc::clone(&entered);
        async move {
            entered.wait().await;
            admission.reserve().await
        }
    });
    entered.wait().await;
    tokio::task::yield_now().await;
    admission.stop();

    let Err(error) = waiter.await.expect("waiter task") else {
        panic!("draining admission must not mint a reservation")
    };
    assert_eq!(error.code(), InvocationAdmissionErrorCode::Draining);
    assert!(error.retryable());
    assert!(!admission.is_accepting());
    assert_eq!(admission.available_capacity(), 0);
    assert!(matches!(
        admission.reserve().await,
        Err(error) if error.code() == InvocationAdmissionErrorCode::Draining
    ));
    drop(held);
    assert_eq!(admission.available_capacity(), 1);
}
