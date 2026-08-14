use std::io;
use std::process::ExitCode;

fn main() -> ExitCode {
    elitea_worker_rust::diagnostics::install_redacted_panic_hook();
    match elitea_worker_rust::run(std::env::args().skip(1), io::stdout().lock()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
