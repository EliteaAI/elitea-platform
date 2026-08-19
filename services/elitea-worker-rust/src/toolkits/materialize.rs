//! Claim-materialized configured toolsets for a direct ADK `LlmAgent`.
//!
//! Main freezes toolkit identity and redeems schema-declared secrets before the
//! worker receives the request. This boundary consumes only that immutable
//! request snapshot, applies one deployment-policy generation, and constructs
//! native ADK toolsets. MCP, nested applications and artifact-owning families
//! have separate authority owners and therefore never fall through this map.

use std::fmt;
use std::sync::Arc;

use adk_rust::Toolset;

use super::families::{
    azure, azure_search, elastic, gcp, gitlab_org, google_places, keycloak, kubernetes, postman,
    rally, report_portal, salesforce, service_now, slack, sonar, sql, yagmail, zephyr,
    zephyr_squad,
};
use super::policy::ToolAdmissionPolicy;
use super::snapshot::{AdmittedToolSnapshot, FrozenToolKind, FrozenToolReference};

const MAX_AGENT_TOOLSETS: usize = 1_024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ToolsetMaterializationErrorCode {
    InvalidConfiguration,
    UnsupportedToolkit,
    ResourceExhausted,
}

#[derive(Clone, Copy)]
pub(crate) struct ToolsetMaterializationError {
    code: ToolsetMaterializationErrorCode,
}

impl ToolsetMaterializationError {
    #[must_use]
    pub(crate) const fn code(self) -> ToolsetMaterializationErrorCode {
        self.code
    }
}

impl fmt::Debug for ToolsetMaterializationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ToolsetMaterializationError")
            .field("code", &self.code)
            .finish_non_exhaustive()
    }
}

impl fmt::Display for ToolsetMaterializationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self.code {
            ToolsetMaterializationErrorCode::InvalidConfiguration => {
                "the frozen toolkit configuration is invalid"
            }
            ToolsetMaterializationErrorCode::UnsupportedToolkit => {
                "the frozen toolkit requires a runtime authority that is not available"
            }
            ToolsetMaterializationErrorCode::ResourceExhausted => {
                "the frozen toolkit set exceeds its approved limit"
            }
        })
    }
}

impl std::error::Error for ToolsetMaterializationError {}

pub(crate) fn materialize_configured_toolsets(
    snapshot: &AdmittedToolSnapshot<'_>,
    policy: &Arc<ToolAdmissionPolicy>,
) -> Result<Vec<Arc<dyn Toolset>>, ToolsetMaterializationError> {
    if snapshot.len() > MAX_AGENT_TOOLSETS {
        return Err(resource_exhausted());
    }
    snapshot
        .iter()
        .filter(|reference| reference.kind() == FrozenToolKind::Configured)
        .map(|reference| materialize(reference, policy))
        .collect()
}

fn materialize(
    reference: &FrozenToolReference<'_>,
    policy: &Arc<ToolAdmissionPolicy>,
) -> Result<Arc<dyn Toolset>, ToolsetMaterializationError> {
    if reference.kind() != FrozenToolKind::Configured {
        return Err(unsupported_toolkit());
    }
    let settings = reference.settings().ok_or_else(invalid_configuration)?;
    let name = reference.toolkit_name();
    if matches!(
        reference.tool_type(),
        "azure"
            | "azure_search"
            | "elastic"
            | "gcp"
            | "gitlab_org"
            | "google_places"
            | "keycloak"
            | "k8s"
    ) {
        return materialize_a_to_k(reference.tool_type(), name, settings, policy);
    }
    materialize_p_to_z(reference.tool_type(), name, settings, policy)
}

fn materialize_a_to_k(
    tool_type: &str,
    name: &str,
    settings: &serde_json::Map<String, serde_json::Value>,
    policy: &Arc<ToolAdmissionPolicy>,
) -> Result<Arc<dyn Toolset>, ToolsetMaterializationError> {
    let toolset = match tool_type {
        "azure" => azure::tools::build_azure_toolset(
            name,
            azure::config::AzureToolkitConfig::parse(settings)
                .map_err(|_| invalid_configuration())?,
            policy,
        )
        .map_err(|_| invalid_configuration())?,
        "azure_search" => azure_search::tools::build_azure_search_read_only_toolset(
            name,
            azure_search::config::AzureSearchToolkitConfig::parse(settings)
                .map_err(|_| invalid_configuration())?,
            policy,
        )
        .map_err(|_| invalid_configuration())?,
        "elastic" => elastic::tools::build_elastic_toolset(
            name,
            elastic::config::ElasticToolkitConfig::parse(settings)
                .map_err(|_| invalid_configuration())?,
            policy,
        )
        .map_err(|_| invalid_configuration())?,
        "gcp" => gcp::tools::build_gcp_toolset(
            name,
            gcp::config::GcpToolkitConfig::parse(settings).map_err(|_| invalid_configuration())?,
            policy,
        )
        .map_err(|_| invalid_configuration())?,
        "gitlab_org" => gitlab_org::tools::build_gitlab_org_toolset(
            name,
            gitlab_org::config::GitLabOrgToolkitConfig::parse(settings)
                .map_err(|_| invalid_configuration())?,
            policy,
        )
        .map_err(|_| invalid_configuration())?,
        "google_places" => google_places::tools::build_google_places_read_only_toolset(
            name,
            google_places::config::GooglePlacesToolkitConfig::parse(settings)
                .map_err(|_| invalid_configuration())?,
            policy,
        )
        .map_err(|_| invalid_configuration())?,
        "keycloak" => keycloak::tools::build_keycloak_toolset(
            name,
            keycloak::config::KeycloakToolkitConfig::parse(settings)
                .map_err(|_| invalid_configuration())?,
            policy,
        )
        .map_err(|_| invalid_configuration())?,
        "k8s" => kubernetes::tools::build_kubernetes_toolset(
            name,
            kubernetes::config::KubernetesToolkitConfig::parse(settings)
                .map_err(|_| invalid_configuration())?,
            policy,
        )
        .map_err(|_| invalid_configuration())?,
        _ => return Err(unsupported_toolkit()),
    };
    Ok(Arc::new(toolset))
}

fn materialize_p_to_z(
    tool_type: &str,
    name: &str,
    settings: &serde_json::Map<String, serde_json::Value>,
    policy: &Arc<ToolAdmissionPolicy>,
) -> Result<Arc<dyn Toolset>, ToolsetMaterializationError> {
    let toolset = match tool_type {
        "postman" => postman::tools::build_postman_toolset(
            name,
            postman::config::PostmanToolkitConfig::parse(settings)
                .map_err(|_| invalid_configuration())?,
            policy,
        )
        .map_err(|_| invalid_configuration())?,
        "rally" => rally::tools::build_rally_toolset(
            name,
            rally::config::RallyToolkitConfig::parse(settings)
                .map_err(|_| invalid_configuration())?,
            policy,
        )
        .map_err(|_| invalid_configuration())?,
        "report_portal" => report_portal::tools::build_report_portal_toolset(
            name,
            report_portal::config::ReportPortalToolkitConfig::parse(settings)
                .map_err(|_| invalid_configuration())?,
            policy,
        )
        .map_err(|_| invalid_configuration())?,
        "salesforce" => salesforce::tools::build_salesforce_toolset(
            name,
            salesforce::config::SalesforceToolkitConfig::parse(settings)
                .map_err(|_| invalid_configuration())?,
            policy,
        )
        .map_err(|_| invalid_configuration())?,
        "service_now" => service_now::tools::build_service_now_toolset(
            name,
            service_now::config::ServiceNowToolkitConfig::parse(settings)
                .map_err(|_| invalid_configuration())?,
            policy,
        )
        .map_err(|_| invalid_configuration())?,
        "slack" => slack::tools::build_slack_toolset(
            name,
            slack::config::SlackToolkitConfig::parse(settings)
                .map_err(|_| invalid_configuration())?,
            policy,
        )
        .map_err(|_| invalid_configuration())?,
        "sonar" => sonar::tools::build_sonar_read_only_toolset(
            name,
            sonar::config::SonarToolkitConfig::parse(settings)
                .map_err(|_| invalid_configuration())?,
            policy,
        )
        .map_err(|_| invalid_configuration())?,
        "sql" => sql::tools::build_sql_toolset(
            name,
            sql::config::SqlToolkitConfig::parse(settings).map_err(|_| invalid_configuration())?,
            policy,
        )
        .map_err(|_| invalid_configuration())?,
        "yagmail" => yagmail::tools::build_yagmail_toolset(
            name,
            yagmail::config::YagmailToolkitConfig::parse(settings)
                .map_err(|_| invalid_configuration())?,
            policy,
        )
        .map_err(|_| invalid_configuration())?,
        "zephyr" => zephyr::tools::build_zephyr_toolset(
            name,
            zephyr::config::ZephyrToolkitConfig::parse(settings)
                .map_err(|_| invalid_configuration())?,
            policy,
        )
        .map_err(|_| invalid_configuration())?,
        "zephyr_squad" => zephyr_squad::tools::build_zephyr_squad_toolset(
            name,
            zephyr_squad::config::ZephyrSquadToolkitConfig::parse(settings)
                .map_err(|_| invalid_configuration())?,
            policy,
        )
        .map_err(|_| invalid_configuration())?,
        // Aha needs a sealed artifact resolver. GitHub is not yet a complete
        // family. MCP and nested applications are rejected above by kind.
        _ => return Err(unsupported_toolkit()),
    };
    Ok(Arc::new(toolset))
}

const fn invalid_configuration() -> ToolsetMaterializationError {
    ToolsetMaterializationError {
        code: ToolsetMaterializationErrorCode::InvalidConfiguration,
    }
}

const fn unsupported_toolkit() -> ToolsetMaterializationError {
    ToolsetMaterializationError {
        code: ToolsetMaterializationErrorCode::UnsupportedToolkit,
    }
}

const fn resource_exhausted() -> ToolsetMaterializationError {
    ToolsetMaterializationError {
        code: ToolsetMaterializationErrorCode::ResourceExhausted,
    }
}
