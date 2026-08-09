use std::net::IpAddr;

use url::{Host, Url};

use super::*;

pub const SERVICE_AGGREGATION_RULE_VERSION: &str = "exact-host-v1";

const SHARED_HOST_SUFFIXES: &[&str] = &[
    "appspot.com",
    "azurewebsites.net",
    "cloudfront.net",
    "github.io",
    "herokuapp.com",
    "netlify.app",
    "notion.site",
    "pages.dev",
    "vercel.app",
];

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ServiceItemKind {
    Login,
    Secret,
    Ssh,
    Identity,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ServiceRelationshipSource {
    Manual,
    AutomaticExactHostV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ServiceRelationship {
    pub item_kind: ServiceItemKind,
    pub item_id: Uuid,
    pub source: ServiceRelationshipSource,
}

impl ServiceRelationship {
    pub fn same_target(&self, other: &Self) -> bool {
        self.item_kind == other.item_kind && self.item_id == other.item_id
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ServiceRecord {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub sites: Vec<String>,
    pub relationships: Vec<ServiceRelationship>,
    pub created_at: u64,
    pub updated_at: u64,
}

impl Zeroize for ServiceRecord {
    fn zeroize(&mut self) {
        self.name.zeroize();
        zeroize_option(&mut self.description);
        self.tags.zeroize();
        self.sites.zeroize();
        self.relationships.clear();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct NewServiceRecord {
    pub name: String,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub sites: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ServiceRecordUpdate {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub sites: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct ServiceItemCounts {
    pub login: u32,
    pub secret: u32,
    pub ssh: u32,
    pub identity: u32,
}

impl ServiceItemCounts {
    pub(crate) fn add(&mut self, kind: ServiceItemKind) {
        let count = match kind {
            ServiceItemKind::Login => &mut self.login,
            ServiceItemKind::Secret => &mut self.secret,
            ServiceItemKind::Ssh => &mut self.ssh,
            ServiceItemKind::Identity => &mut self.identity,
        };
        *count = count.saturating_add(1);
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ServiceSummary {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub site_count: u32,
    pub counts: ServiceItemCounts,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ServiceDetail {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub sites: Vec<String>,
    pub relationships: Vec<ServiceRelationship>,
    pub counts: ServiceItemCounts,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TrashedServiceRecord {
    pub trash_id: Uuid,
    pub deleted_at: u64,
    pub item: ServiceRecord,
}

impl Zeroize for TrashedServiceRecord {
    fn zeroize(&mut self) {
        self.item.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ServiceTrashSummary {
    pub trash_id: Uuid,
    pub service_id: Uuid,
    pub name: String,
    pub deleted_at: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ServiceRevision {
    pub revision_id: Uuid,
    pub service_id: Uuid,
    pub saved_at: u64,
    pub item: ServiceRecord,
}

impl Zeroize for ServiceRevision {
    fn zeroize(&mut self) {
        self.item.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ServiceRevisionSummary {
    pub revision_id: Uuid,
    pub service_id: Uuid,
    pub name: String,
    pub saved_at: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ServiceIgnoredSuggestion {
    pub service_key: String,
    pub item_kind: ServiceItemKind,
    pub item_id: Uuid,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ServiceAggregationCluster {
    pub service_key: String,
    pub suggested_name: String,
    pub suggested_site: String,
    pub existing_service_id: Option<Uuid>,
    pub reason: String,
    pub relationships: Vec<ServiceRelationship>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ServiceAggregationPlan {
    pub plan_id: String,
    pub vault_namespace: String,
    pub catalog_revision: String,
    pub rule_version: String,
    pub input_digest: String,
    pub clusters: Vec<ServiceAggregationCluster>,
    pub review_items: Vec<ServiceAggregationReviewItem>,
    pub high_confidence_item_count: u32,
    pub conflict_count: u32,
    pub ungrouped_count: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ServiceAggregationReviewItem {
    pub item_kind: ServiceItemKind,
    pub item_id: Uuid,
    pub label: String,
    pub reason: ServiceAggregationReviewReason,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ServiceAggregationReviewReason {
    ConflictingMetadata,
    NoSafeKey,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ServiceAggregationBatch {
    pub batch_id: Uuid,
    pub plan_id: String,
    pub applied_at: u64,
    pub created_service_ids: Vec<Uuid>,
    pub added_relationships: Vec<ServiceBatchRelationship>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ServiceBatchRelationship {
    pub service_id: Uuid,
    pub relationship: ServiceRelationship,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ServiceAggregationApplyResult {
    pub batch_id: Uuid,
    pub created_service_count: u32,
    pub linked_item_count: u32,
    pub already_applied: bool,
}

pub(crate) fn normalize_new_service(input: &mut NewServiceRecord) -> Result<(), VaultError> {
    trim_string(&mut input.name);
    trim_option(&mut input.description);
    for tag in &mut input.tags {
        trim_string(tag);
    }
    input.tags.retain(|tag| !tag.is_empty());
    input.tags.sort();
    input.tags.dedup();
    input.sites = input
        .sites
        .iter()
        .map(|site| canonical_service_site(site))
        .collect::<Result<Vec<_>, _>>()?;
    input.sites.sort();
    input.sites.dedup();
    if input.name.is_empty()
        || input.name.encode_utf16().count() > 256
        || input
            .description
            .as_ref()
            .is_some_and(|value| value.encode_utf16().count() > 10_000)
        || input.tags.len() > 50
        || input
            .tags
            .iter()
            .any(|tag| tag.encode_utf16().count() > 128)
        || input.sites.is_empty()
        || input.sites.len() > 20
    {
        return Err(VaultError::InvalidService);
    }
    Ok(())
}

pub(crate) fn canonical_service_site(value: &str) -> Result<String, VaultError> {
    let mut url = Url::parse(value.trim()).map_err(|_| VaultError::InvalidService)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(VaultError::InvalidService);
    }
    url.set_fragment(None);
    url.set_query(None);
    if url.path() == "/" {
        url.set_path("");
    }
    Ok(url.to_string().trim_end_matches('/').to_owned())
}

pub(crate) fn canonical_http_candidate(value: &str) -> Option<(String, String)> {
    let url = Url::parse(value.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    let default_port = match url.scheme() {
        "http" => 80,
        "https" => 443,
        _ => return None,
    };
    if url.port().is_some_and(|port| port != default_port) {
        return None;
    }
    let host = canonical_automatic_host(url.host()?)?;
    Some((
        format!("host-v1:{host}"),
        format!("{}://{host}", url.scheme()),
    ))
}

pub(crate) fn canonical_ssh_candidate(host: &str, port: u16) -> Option<(String, String)> {
    if port != 22 {
        return None;
    }
    let host = Host::parse(host.trim().trim_end_matches('.')).ok()?;
    let host = canonical_automatic_host(host)?;
    Some((format!("host-v1:{host}"), format!("https://{host}")))
}

fn canonical_automatic_host<T: AsRef<str>>(host: Host<T>) -> Option<String> {
    let mut host = match host {
        Host::Domain(value) => value.as_ref().trim_end_matches('.').to_ascii_lowercase(),
        Host::Ipv4(_) | Host::Ipv6(_) => return None,
    };
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.parse::<IpAddr>().is_ok()
        || SHARED_HOST_SUFFIXES
            .iter()
            .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
    {
        return None;
    }
    if let Some(stripped) = host.strip_prefix("www.") {
        host = stripped.to_owned();
    }
    (!host.is_empty() && host.contains('.')).then_some(host)
}
