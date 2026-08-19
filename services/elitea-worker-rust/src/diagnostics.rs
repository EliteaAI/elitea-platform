//! Process-wide diagnostic safety boundaries.

use std::fmt;
use std::io::{self, Write};
use std::sync::Once;

use tracing_subscriber::EnvFilter;
use tracing_subscriber::fmt::format::FmtSpan;
use tracing_subscriber::util::SubscriberInitExt as _;

static PANIC_HOOK: Once = Once::new();
const LOG_LEVEL_ENVIRONMENT: &str = "ELITEA_RUST_LOG";

/// Process-level tracing setup failures with no environment contents exposed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DiagnosticInitError {
    InvalidLogLevel,
    SubscriberUnavailable,
}

impl fmt::Display for DiagnosticInitError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidLogLevel => formatter
                .write_str("ELITEA_RUST_LOG must be off, error, warn, info, debug, or trace"),
            Self::SubscriberUnavailable => {
                formatter.write_str("the structured tracing subscriber could not be installed")
            }
        }
    }
}

impl std::error::Error for DiagnosticInitError {}

/// Install the process subscriber for safe Elitea-owned spans.
///
/// Only a single level is accepted and it is applied exclusively to this
/// crate. Arbitrary `RUST_LOG` directives are deliberately ignored so enabling
/// local diagnostics cannot expose dependency-owned HTTP, model, SMTP or SQL
/// fields. Span close events supply phase duration without logging payloads.
///
/// # Errors
///
/// Returns [`DiagnosticInitError::InvalidLogLevel`] for an unsupported log
/// level and [`DiagnosticInitError::SubscriberUnavailable`] if another global
/// subscriber is already installed or process-level installation fails.
pub fn install_tracing_subscriber() -> Result<(), DiagnosticInitError> {
    let configured = std::env::var(LOG_LEVEL_ENVIRONMENT).ok();
    let directive = tracing_directive(configured.as_deref())?;
    let filter = EnvFilter::try_new(directive).map_err(|_| DiagnosticInitError::InvalidLogLevel)?;
    tracing_subscriber::fmt()
        .compact()
        .with_target(true)
        .with_thread_ids(true)
        .with_span_events(FmtSpan::CLOSE)
        .with_env_filter(filter)
        .finish()
        .try_init()
        .map_err(|_| DiagnosticInitError::SubscriberUnavailable)
}

fn tracing_directive(configured: Option<&str>) -> Result<String, DiagnosticInitError> {
    let level = configured.unwrap_or("info").trim().to_ascii_lowercase();
    if !matches!(
        level.as_str(),
        "off" | "error" | "warn" | "info" | "debug" | "trace"
    ) {
        return Err(DiagnosticInitError::InvalidLogLevel);
    }
    Ok(format!("elitea_worker_rust={level}"))
}

/// Install a static panic hook before worker tasks or external adapters run.
///
/// Rust's default hook prints the arbitrary panic payload and source location.
/// Provider, model, or tool code can panic with request data, so the worker
/// replaces that hook instead of treating a redacted task error as sufficient.
/// Repeated calls are harmless.
pub fn install_redacted_panic_hook() {
    PANIC_HOOK.call_once(|| {
        std::panic::set_hook(Box::new(|_| {
            let _ignored = io::stderr()
                .lock()
                .write_all(b"elitea worker task panicked; details redacted\n");
        }));
    });
}

#[cfg(test)]
mod tests {
    use super::{DiagnosticInitError, tracing_directive};

    #[test]
    fn tracing_level_is_crate_scoped_and_rejects_directives() {
        assert_eq!(
            tracing_directive(None).expect("default tracing directive"),
            "elitea_worker_rust=info"
        );
        assert_eq!(
            tracing_directive(Some(" DEBUG ")).expect("debug tracing directive"),
            "elitea_worker_rust=debug"
        );
        assert_eq!(
            tracing_directive(Some("trace,hyper=trace")),
            Err(DiagnosticInitError::InvalidLogLevel)
        );
    }
}
