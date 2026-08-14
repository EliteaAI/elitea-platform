//! Process-wide diagnostic safety boundaries.

use std::io::{self, Write};
use std::sync::Once;

static PANIC_HOOK: Once = Once::new();

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
