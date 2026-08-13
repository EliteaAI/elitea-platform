pub mod command;
mod error;
pub mod node_event;
pub mod output;
mod wire;

// Generated protobuf and gRPC clients mirror comments and method shapes owned
// by the language-neutral schema generator, not this crate's handwritten API.
#[allow(clippy::all, clippy::pedantic)]
pub mod generated {
    include!(concat!(env!("OUT_DIR"), "/elitea.rs"));
}

pub use error::ProtocolError;
pub use generated::elitea;
