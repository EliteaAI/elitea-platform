//! Frozen toolkit references admitted with one agent request.
//!
//! The current Main service resolves configured toolkit settings to immutable
//! references before dispatch. This module validates that frozen boundary but
//! deliberately performs no credential redemption, discovery, or invocation.

#![allow(dead_code)] // Materialization remains capability-gated.

mod families;
mod invocation;
mod policy;
mod snapshot;

#[cfg(test)]
mod azure_search_tests;
#[cfg(test)]
mod github_tests;
#[cfg(test)]
mod google_places_tests;
#[cfg(test)]
mod invocation_tests;
#[cfg(test)]
mod policy_tests;
#[cfg(test)]
mod rally_tests;
#[cfg(test)]
mod salesforce_tests;
#[cfg(test)]
mod service_now_tests;
#[cfg(test)]
mod slack_tests;
#[cfg(test)]
mod snapshot_tests;
#[cfg(test)]
mod sonar_tests;
