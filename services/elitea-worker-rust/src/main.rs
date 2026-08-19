#![cfg_attr(
    not(test),
    deny(
        clippy::expect_used,
        clippy::panic,
        clippy::todo,
        clippy::unimplemented,
        clippy::unwrap_used
    )
)]

use std::io;
use std::process::ExitCode;

fn main() -> ExitCode {
    elitea_worker_rust::diagnostics::install_redacted_panic_hook();
    if let Err(error) = elitea_worker_rust::diagnostics::install_tracing_subscriber() {
        eprintln!("{error}");
        return ExitCode::FAILURE;
    }
    match elitea_worker_rust::run(std::env::args().skip(1), io::stdout().lock()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
