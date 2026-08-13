use std::fmt;

/// Stable, data-free error classification for language-neutral boundaries.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProtocolError {
    InvalidInput(&'static str),
    ResourceExhausted(&'static str),
    IncompatibleVersion(&'static str),
    AuthorizationFailed(&'static str),
    UnsupportedCapability(&'static str),
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput(message)
            | Self::ResourceExhausted(message)
            | Self::IncompatibleVersion(message)
            | Self::AuthorizationFailed(message)
            | Self::UnsupportedCapability(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for ProtocolError {}
