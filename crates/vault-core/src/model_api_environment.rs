use url::Url;

use super::*;

pub const API_ENVIRONMENT_POLICY_REVISION: &str = "api-environment-v2";

const MAX_HEADERS: usize = 32;
const MAX_HEADER_NAME_UTF16: usize = 64;
const MAX_HEADER_VALUE_UTF16: usize = 1_024;
const MAX_URL_UTF16: usize = 2_048;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApiEnvironmentKind {
    Production,
    Staging,
    Development,
    Local,
    Other,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApiCredentialItemKind {
    Login,
    Secret,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApiCredentialField {
    LoginUsername,
    LoginPassword,
    SecretValue,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ApiCredentialRef {
    pub item_kind: ApiCredentialItemKind,
    pub item_id: Uuid,
    pub field: ApiCredentialField,
    pub expected_secret_kind: Option<SecretItemKind>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApiKeyLocation {
    Header,
    Query,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ApiEnvironmentAuth {
    None,
    Bearer {
        credential: ApiCredentialRef,
    },
    Basic {
        username: ApiCredentialRef,
        password: ApiCredentialRef,
    },
    ApiKey {
        location: ApiKeyLocation,
        name: String,
        credential: ApiCredentialRef,
    },
}

impl ApiEnvironmentAuth {
    pub fn kind_name(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Bearer { .. } => "bearer",
            Self::Basic { .. } => "basic",
            Self::ApiKey { .. } => "api-key",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ApiHeaderSource {
    Literal { value: String },
    Protected { credential: ApiCredentialRef },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ApiFixedHeader {
    pub name: String,
    pub source: ApiHeaderSource,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ApiEnvironmentRecord {
    pub id: Uuid,
    pub service_id: Uuid,
    pub name: String,
    pub kind: ApiEnvironmentKind,
    pub origin: String,
    pub base_path: Option<String>,
    pub openapi_url: Option<String>,
    pub auth: ApiEnvironmentAuth,
    pub fixed_headers: Vec<ApiFixedHeader>,
    pub revision: u64,
    pub policy_digest: String,
    pub created_at: u64,
    pub updated_at: u64,
}

impl Zeroize for ApiEnvironmentRecord {
    fn zeroize(&mut self) {
        self.name.zeroize();
        self.origin.zeroize();
        zeroize_option(&mut self.base_path);
        zeroize_option(&mut self.openapi_url);
        for header in &mut self.fixed_headers {
            header.name.zeroize();
            if let ApiHeaderSource::Literal { value } = &mut header.source {
                value.zeroize();
            }
        }
        self.fixed_headers.clear();
        self.policy_digest.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NewApiEnvironment {
    pub service_id: Uuid,
    pub name: String,
    pub kind: ApiEnvironmentKind,
    pub origin: String,
    pub base_path: Option<String>,
    pub openapi_url: Option<String>,
    pub auth: ApiEnvironmentAuth,
    pub fixed_headers: Vec<ApiFixedHeader>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ApiEnvironmentUpdate {
    pub id: Uuid,
    #[serde(flatten)]
    pub input: NewApiEnvironment,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ApiEnvironmentSummary {
    pub id: Uuid,
    pub service_id: Uuid,
    pub name: String,
    pub kind: ApiEnvironmentKind,
    pub auth_kind: String,
    pub fixed_header_count: u32,
    pub revision: u64,
    pub policy_digest: String,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ApiEnvironmentDetail {
    pub id: Uuid,
    pub service_id: Uuid,
    pub name: String,
    pub kind: ApiEnvironmentKind,
    pub origin: String,
    pub base_path: Option<String>,
    pub openapi_url: Option<String>,
    pub auth: ApiEnvironmentAuth,
    pub fixed_headers: Vec<ApiFixedHeader>,
    pub revision: u64,
    pub policy_digest: String,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TrashedApiEnvironment {
    pub trash_id: Uuid,
    pub deleted_at: u64,
    pub item: ApiEnvironmentRecord,
}

impl Zeroize for TrashedApiEnvironment {
    fn zeroize(&mut self) {
        self.item.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ApiEnvironmentTrashSummary {
    pub trash_id: Uuid,
    pub environment_id: Uuid,
    pub service_id: Uuid,
    pub name: String,
    pub deleted_at: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ApiEnvironmentRevision {
    pub revision_id: Uuid,
    pub environment_id: Uuid,
    pub saved_at: u64,
    pub item: ApiEnvironmentRecord,
}

impl Zeroize for ApiEnvironmentRevision {
    fn zeroize(&mut self) {
        self.item.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ApiEnvironmentRevisionSummary {
    pub revision_id: Uuid,
    pub environment_id: Uuid,
    pub name: String,
    pub revision: u64,
    pub saved_at: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AgentApiEnvironmentSummary {
    pub environment_ref: Uuid,
    pub label: String,
    pub environment: ApiEnvironmentKind,
    pub capability: String,
    pub openapi_url: Option<String>,
    pub revision: u64,
    pub policy_digest: String,
}

pub(crate) fn normalize_api_environment(input: &mut NewApiEnvironment) -> Result<(), VaultError> {
    trim_string(&mut input.name);
    if input.name.is_empty()
        || input.name.encode_utf16().count() > 128
        || input.name.chars().any(char::is_control)
        || input.fixed_headers.len() > MAX_HEADERS
    {
        return Err(VaultError::InvalidApiEnvironment);
    }
    input.origin = canonical_api_origin(&input.origin)?;
    input.base_path = canonical_api_base_path(input.base_path.take())?;
    input.openapi_url = canonical_openapi_url(input.openapi_url.take())?;
    normalize_auth(&mut input.auth)?;

    let mut names = std::collections::HashSet::new();
    for header in &mut input.fixed_headers {
        header.name = header.name.trim().to_ascii_lowercase();
        if !valid_header_name(&header.name)
            || reserved_header_name(&header.name)
            || auth_header_name(&input.auth).is_some_and(|name| name == header.name)
            || !names.insert(header.name.clone())
        {
            return Err(VaultError::InvalidApiEnvironment);
        }
        match &mut header.source {
            ApiHeaderSource::Literal { value } => {
                *value = value.trim().to_owned();
                if value.is_empty()
                    || value.encode_utf16().count() > MAX_HEADER_VALUE_UTF16
                    || value.chars().any(char::is_control)
                    || looks_like_secret_literal(&header.name, value)
                {
                    return Err(VaultError::InvalidApiEnvironment);
                }
            }
            ApiHeaderSource::Protected { credential } => validate_ref_shape(credential)?,
        }
    }
    input
        .fixed_headers
        .sort_by(|left, right| left.name.cmp(&right.name));
    Ok(())
}

pub(crate) fn api_environment_policy_digest(
    input: &NewApiEnvironment,
    revision: u64,
) -> Result<String, VaultError> {
    let bytes = serde_json::to_vec(&serde_json::json!({
        "policy": API_ENVIRONMENT_POLICY_REVISION,
        "revision": revision,
        "serviceId": input.service_id,
        "name": input.name,
        "kind": input.kind,
        "origin": input.origin,
        "basePath": input.base_path,
        "openapiUrl": input.openapi_url,
        "auth": input.auth,
        "fixedHeaders": input.fixed_headers,
    }))
    .map_err(|_| VaultError::Serialization)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

pub(crate) fn credential_ref_live(payload: &VaultPayload, reference: &ApiCredentialRef) -> bool {
    match (reference.item_kind, reference.field) {
        (ApiCredentialItemKind::Login, ApiCredentialField::LoginUsername) => payload
            .items
            .iter()
            .find(|item| item.id == reference.item_id)
            .is_some_and(|item| {
                !item.username.is_empty() && reference.expected_secret_kind.is_none()
            }),
        (ApiCredentialItemKind::Login, ApiCredentialField::LoginPassword) => payload
            .items
            .iter()
            .find(|item| item.id == reference.item_id)
            .is_some_and(|item| {
                !item.password.is_empty() && reference.expected_secret_kind.is_none()
            }),
        (ApiCredentialItemKind::Secret, ApiCredentialField::SecretValue) => payload
            .secrets
            .iter()
            .find(|item| item.id == reference.item_id)
            .is_some_and(|item| {
                reference.expected_secret_kind.as_ref() == Some(&item.kind)
                    && !item.secret.is_empty()
                    && !item.scopes.iter().any(|scope| {
                        matches!(
                            scope.as_str(),
                            "vaultmesh:credential-lifecycle:revoked"
                                | "vaultmesh:credential-lifecycle:needs-review"
                        )
                    })
            }),
        _ => false,
    }
}

pub(crate) fn api_environment_refs_live(
    payload: &VaultPayload,
    environment: &ApiEnvironmentRecord,
) -> bool {
    let auth_live = match &environment.auth {
        ApiEnvironmentAuth::None => true,
        ApiEnvironmentAuth::Bearer { credential } => {
            credential.expected_secret_kind == Some(SecretItemKind::AccessToken)
                && credential_ref_live(payload, credential)
        }
        ApiEnvironmentAuth::Basic { username, password } => {
            credential_ref_live(payload, username) && credential_ref_live(payload, password)
        }
        ApiEnvironmentAuth::ApiKey { credential, .. } => {
            credential.expected_secret_kind == Some(SecretItemKind::ApiKey)
                && credential_ref_live(payload, credential)
        }
    };
    auth_live
        && environment
            .fixed_headers
            .iter()
            .all(|header| match &header.source {
                ApiHeaderSource::Literal { .. } => true,
                ApiHeaderSource::Protected { credential } => {
                    credential_ref_live(payload, credential)
                }
            })
}

fn normalize_auth(auth: &mut ApiEnvironmentAuth) -> Result<(), VaultError> {
    match auth {
        ApiEnvironmentAuth::None => Ok(()),
        ApiEnvironmentAuth::Bearer { credential } => {
            validate_ref_shape(credential)?;
            if credential.item_kind != ApiCredentialItemKind::Secret
                || credential.field != ApiCredentialField::SecretValue
                || credential.expected_secret_kind != Some(SecretItemKind::AccessToken)
            {
                return Err(VaultError::InvalidApiEnvironment);
            }
            Ok(())
        }
        ApiEnvironmentAuth::Basic { username, password } => {
            validate_ref_shape(username)?;
            validate_ref_shape(password)?;
            if username.field != ApiCredentialField::LoginUsername
                || !matches!(
                    password.field,
                    ApiCredentialField::LoginPassword | ApiCredentialField::SecretValue
                )
            {
                return Err(VaultError::InvalidApiEnvironment);
            }
            Ok(())
        }
        ApiEnvironmentAuth::ApiKey {
            location,
            name,
            credential,
        } => {
            *name = name.trim().to_owned();
            validate_ref_shape(credential)?;
            if name.is_empty()
                || name.encode_utf16().count() > 128
                || name.chars().any(char::is_control)
                || match location {
                    ApiKeyLocation::Header => {
                        !valid_header_name(name) || reserved_header_name(&name.to_ascii_lowercase())
                    }
                    ApiKeyLocation::Query => !valid_query_parameter_name(name),
                }
                || credential.item_kind != ApiCredentialItemKind::Secret
                || credential.field != ApiCredentialField::SecretValue
                || credential.expected_secret_kind != Some(SecretItemKind::ApiKey)
            {
                return Err(VaultError::InvalidApiEnvironment);
            }
            Ok(())
        }
    }
}

fn validate_ref_shape(reference: &ApiCredentialRef) -> Result<(), VaultError> {
    let valid = match (reference.item_kind, reference.field) {
        (
            ApiCredentialItemKind::Login,
            ApiCredentialField::LoginUsername | ApiCredentialField::LoginPassword,
        ) => reference.expected_secret_kind.is_none(),
        (ApiCredentialItemKind::Secret, ApiCredentialField::SecretValue) => {
            reference.expected_secret_kind.is_some()
        }
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(VaultError::InvalidApiEnvironment)
    }
}

fn canonical_api_origin(value: &str) -> Result<String, VaultError> {
    reject_ambiguous_url_input(value)?;
    let value = value.trim();
    if value.encode_utf16().count() > MAX_URL_UTF16 {
        return Err(VaultError::InvalidApiEnvironment);
    }
    let parsed = Url::parse(value).map_err(|_| VaultError::InvalidApiEnvironment)?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.host_str().is_none()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(VaultError::InvalidApiEnvironment);
    }
    Ok(parsed.origin().ascii_serialization())
}

fn canonical_api_base_path(value: Option<String>) -> Result<Option<String>, VaultError> {
    let Some(value) = value else { return Ok(None) };
    let value = value.trim();
    if value.is_empty() || value == "/" {
        return Ok(None);
    }
    if value.encode_utf16().count() > MAX_URL_UTF16 {
        return Err(VaultError::InvalidApiEnvironment);
    }
    reject_ambiguous_url_input(value)?;
    if !value.starts_with('/')
        || value.starts_with("//")
        || value.contains(['?', '#', '%'])
        || value
            .split('/')
            .any(|segment| matches!(segment, "." | ".."))
    {
        return Err(VaultError::InvalidApiEnvironment);
    }
    let canonical = format!(
        "/{}",
        value
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>()
            .join("/")
    );
    Ok(Some(canonical))
}

fn canonical_openapi_url(value: Option<String>) -> Result<Option<String>, VaultError> {
    let Some(value) = value else { return Ok(None) };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.encode_utf16().count() > MAX_URL_UTF16 {
        return Err(VaultError::InvalidApiEnvironment);
    }
    reject_ambiguous_url_input(value)?;
    let parsed = Url::parse(value).map_err(|_| VaultError::InvalidApiEnvironment)?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.host_str().is_none()
    {
        return Err(VaultError::InvalidApiEnvironment);
    }
    Ok(Some(value.to_owned()))
}

fn reject_ambiguous_url_input(value: &str) -> Result<(), VaultError> {
    let lower = value.to_ascii_lowercase();
    if value.trim().is_empty()
        || value.contains('\\')
        || value.chars().any(char::is_control)
        || ["%2f", "%5c", "%2e"]
            .iter()
            .any(|needle| lower.contains(needle))
    {
        Err(VaultError::InvalidApiEnvironment)
    } else {
        Ok(())
    }
}

pub(crate) fn valid_header_name(value: &str) -> bool {
    !value.is_empty()
        && value.encode_utf16().count() <= MAX_HEADER_NAME_UTF16
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(
                    byte,
                    b'!' | b'#'
                        | b'$'
                        | b'%'
                        | b'&'
                        | b'\''
                        | b'*'
                        | b'+'
                        | b'-'
                        | b'.'
                        | b'^'
                        | b'_'
                        | b'`'
                        | b'|'
                        | b'~'
                )
        })
}

pub(crate) fn reserved_header_name(name: &str) -> bool {
    matches!(
        name,
        "authorization"
            | "cookie"
            | "host"
            | "connection"
            | "content-length"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    ) || name.starts_with("proxy-")
}

pub(crate) fn auth_header_name(auth: &ApiEnvironmentAuth) -> Option<String> {
    match auth {
        ApiEnvironmentAuth::Bearer { .. } | ApiEnvironmentAuth::Basic { .. } => {
            Some("authorization".to_owned())
        }
        ApiEnvironmentAuth::ApiKey {
            location: ApiKeyLocation::Header,
            name,
            ..
        } => Some(name.to_ascii_lowercase()),
        ApiEnvironmentAuth::None
        | ApiEnvironmentAuth::ApiKey {
            location: ApiKeyLocation::Query,
            ..
        } => None,
    }
}

pub(crate) fn valid_query_parameter_name(value: &str) -> bool {
    !value.is_empty()
        && value.encode_utf16().count() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~'))
}

pub(crate) fn looks_like_secret_literal(name: &str, value: &str) -> bool {
    let sensitive_name = name.split(['-', '_']).any(|part| {
        matches!(
            part,
            "auth" | "authorization" | "cookie" | "key" | "password" | "secret" | "token"
        )
    });
    let lower_value = value.to_ascii_lowercase();
    sensitive_name
        || lower_value.starts_with("bearer ")
        || lower_value.starts_with("basic ")
        || lower_value.contains("-----begin ")
}
