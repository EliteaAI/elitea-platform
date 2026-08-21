#![forbid(unsafe_code)]
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

pub mod agents;
pub mod capabilities;
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub mod config;
pub mod diagnostics;
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub mod execution;
pub mod protocol;
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub mod security;
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub mod spool;
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub mod state;
mod toolkits;
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub mod transport;

use std::fmt;
use std::io::{self, Write};

#[derive(Debug)]
pub enum CliError {
    InvalidArguments,
    Serialize(serde_json::Error),
    Write(io::Error),
}

impl fmt::Display for CliError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidArguments => {
                formatter.write_str("usage: elitea-worker-rust capabilities --json")
            }
            Self::Serialize(_) => formatter.write_str("failed to serialize capabilities"),
            Self::Write(_) => formatter.write_str("failed to write capabilities"),
        }
    }
}

impl std::error::Error for CliError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::InvalidArguments => None,
            Self::Serialize(error) => Some(error),
            Self::Write(error) => Some(error),
        }
    }
}

/// Execute the deliberately small reconstruction CLI.
///
/// # Errors
///
/// Returns [`CliError::InvalidArguments`] for every command that is not yet
/// admitted, and preserves serialization or output failures without exposing
/// their internal details through its [`std::fmt::Display`] implementation.
pub fn run<I, S, W>(arguments: I, mut output: W) -> Result<(), CliError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
    W: Write,
{
    let arguments = arguments
        .into_iter()
        .map(|argument| argument.as_ref().to_owned())
        .collect::<Vec<_>>();
    if arguments.as_slice() != ["capabilities", "--json"] {
        return Err(CliError::InvalidArguments);
    }

    serde_json::to_writer(&mut output, &capabilities::report()).map_err(CliError::Serialize)?;
    output.write_all(b"\n").map_err(CliError::Write)
}

#[cfg(test)]
mod tests {
    use super::{CliError, run};

    #[test]
    fn capabilities_json_is_deterministic_and_fail_closed() {
        let mut output = Vec::new();

        run(["capabilities", "--json"], &mut output).expect("capabilities command");

        assert_eq!(
            String::from_utf8(output).expect("UTF-8 output"),
            concat!(
                "{\"schema_revision\":\"elitea.rust-worker.capability-foundation.v1\",",
                "\"implementation_name\":\"elitea-worker-rust\",",
                "\"language\":\"rust\",\"runtime_version\":\"0.1.0\",",
                "\"startup_mode\":\"offline_conformance\",",
                "\"production_registration_enabled\":false,",
                "\"production_capabilities\":[]}\n"
            )
        );
    }

    #[test]
    fn unsupported_commands_fail_without_output() {
        let mut output = Vec::new();

        let error = run(["serve"], &mut output).expect_err("serve is not admitted");

        assert!(matches!(error, CliError::InvalidArguments));
        assert!(output.is_empty());
    }
}
