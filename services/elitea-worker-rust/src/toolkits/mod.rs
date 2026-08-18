//! Frozen toolkit references admitted with one agent request.
//!
//! The current Main service resolves configured toolkit settings to immutable
//! references before dispatch. This module validates that frozen boundary but
//! deliberately performs no credential redemption, discovery, or invocation.

#![allow(dead_code)] // Materialization remains capability-gated.

mod policy;
mod snapshot;

#[cfg(test)]
mod policy_tests;
#[cfg(test)]
mod snapshot_tests;
