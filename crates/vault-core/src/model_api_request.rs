use serde_json::Value;
use zeroize::{Zeroize, Zeroizing};

use super::*;

pub const API_REQUEST_POLICY_REVISION: &str = "desktop-api-request-v1";
pub const MAX_API_REQUEST_BODY_BYTES: usize = 256 * 1024;
const MAX_API_REQUEST_QUERY: usize = 32;
const MAX_API_REQUEST_HEADERS: usize = 32;
const MAX_API_REQUEST_VALUE_UTF16: usize = 2_048;
const MAX_API_REQUEST_JSON_DEPTH: usize = 16;
const MAX_API_REQUEST_JSON_ITEMS: usize = 2_048;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiRequestPair {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ApiRequestBodyInput {
    None,
    Json { value: String },
    Text { value: String },
}

impl ApiRequestBodyInput {
    pub fn kind_name(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Json { .. } => "json",
            Self::Text { .. } => "text",
        }
    }
}

impl Zeroize for ApiRequestBodyInput {
    fn zeroize(&mut self) {
        match self {
            Self::None => {}
            Self::Json { value } | Self::Text { value } => value.zeroize(),
        }
    }
}

impl Drop for ApiRequestBodyInput {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiRequestInput {
    pub environment_id: Uuid,
    pub method: String,
    pub path: String,
    #[serde(default)]
    pub query: Vec<ApiRequestPair>,
    #[serde(default)]
    pub headers: Vec<ApiRequestPair>,
    pub body: ApiRequestBodyInput,
}

impl Zeroize for ApiRequestInput {
    fn zeroize(&mut self) {
        self.method.zeroize();
        self.path.zeroize();
        for pair in self.query.iter_mut().chain(self.headers.iter_mut()) {
            pair.name.zeroize();
            pair.value.zeroize();
        }
        self.query.clear();
        self.headers.clear();
        self.body.zeroize();
    }
}

impl Drop for ApiRequestInput {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiRequestPlanSummary {
    pub environment_id: Uuid,
    pub environment_revision: u64,
    pub environment_policy_digest: String,
    pub request_digest: String,
    pub method: String,
    pub origin: String,
    pub base_path: Option<String>,
    pub path: String,
    pub body_type: String,
    pub query_count: u32,
    pub request_header_count: u32,
    pub fixed_header_count: u32,
    pub auth_type: String,
    pub mutation: bool,
}

pub struct ApiRequestValueMaterial {
    pub name: String,
    pub value: Zeroizing<String>,
}

pub enum ApiRequestAuthenticationMaterial {
    None,
    Bearer {
        token: Zeroizing<String>,
    },
    Basic {
        username: Zeroizing<String>,
        password: Zeroizing<String>,
    },
    ApiKey {
        location: ApiKeyLocation,
        name: String,
        value: Zeroizing<String>,
    },
}

pub struct ApiRequestExecutionPlan {
    pub summary: ApiRequestPlanSummary,
    pub query: Vec<ApiRequestValueMaterial>,
    pub headers: Vec<ApiRequestValueMaterial>,
    pub body: ApiRequestBodyInput,
    pub authentication: ApiRequestAuthenticationMaterial,
    pub canaries: Zeroizing<Vec<String>>,
}

pub(crate) fn normalize_api_request(
    input: &mut ApiRequestInput,
    environment: &ApiEnvironmentRecord,
) -> Result<(), VaultError> {
    if !matches!(
        input.method.as_str(),
        "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE"
    ) || input.method != input.method.to_ascii_uppercase()
        || input.query.len() > MAX_API_REQUEST_QUERY
        || input.headers.len() > MAX_API_REQUEST_HEADERS
    {
        return Err(VaultError::InvalidApiRequest);
    }
    input.path = canonical_api_request_path(&input.path)?;
    input.path = join_api_base_path(environment.base_path.as_deref(), &input.path)?;

    let mut query_names = std::collections::HashSet::new();
    for pair in &mut input.query {
        pair.name = pair.name.trim().to_owned();
        if !valid_query_parameter_name(&pair.name)
            || !query_names.insert(pair.name.clone())
            || pair.value.encode_utf16().count() > MAX_API_REQUEST_VALUE_UTF16
            || pair.value.chars().any(char::is_control)
        {
            return Err(VaultError::InvalidApiRequest);
        }
    }
    input
        .query
        .sort_by(|left, right| left.name.cmp(&right.name));

    let fixed_names = environment
        .fixed_headers
        .iter()
        .map(|header| header.name.to_ascii_lowercase())
        .collect::<std::collections::HashSet<_>>();
    let auth_name = auth_header_name(&environment.auth);
    let mut header_names = std::collections::HashSet::new();
    for pair in &mut input.headers {
        pair.name = pair.name.trim().to_ascii_lowercase();
        pair.value = pair.value.trim().to_owned();
        if !valid_header_name(&pair.name)
            || reserved_header_name(&pair.name)
            || fixed_names.contains(&pair.name)
            || auth_name.as_deref() == Some(pair.name.as_str())
            || !header_names.insert(pair.name.clone())
            || pair.value.is_empty()
            || pair.value.encode_utf16().count() > 1_024
            || pair.value.chars().any(char::is_control)
            || looks_like_secret_literal(&pair.name, &pair.value)
        {
            return Err(VaultError::InvalidApiRequest);
        }
    }
    input
        .headers
        .sort_by(|left, right| left.name.cmp(&right.name));

    match &mut input.body {
        ApiRequestBodyInput::None => {}
        ApiRequestBodyInput::Json { value } => {
            if matches!(input.method.as_str(), "GET" | "HEAD")
                || value.len() > MAX_API_REQUEST_BODY_BYTES
            {
                return Err(VaultError::InvalidApiRequest);
            }
            let parsed =
                serde_json::from_str::<Value>(value).map_err(|_| VaultError::InvalidApiRequest)?;
            let mut items = 0_usize;
            validate_json_shape(&parsed, 0, &mut items)?;
            *value = serde_json::to_string(&parsed).map_err(|_| VaultError::Serialization)?;
        }
        ApiRequestBodyInput::Text { value } => {
            if matches!(input.method.as_str(), "GET" | "HEAD")
                || value.len() > MAX_API_REQUEST_BODY_BYTES
                || value.chars().any(|character| character == '\0')
            {
                return Err(VaultError::InvalidApiRequest);
            }
        }
    }
    Ok(())
}

pub(crate) fn api_request_digest(
    input: &ApiRequestInput,
    environment: &ApiEnvironmentRecord,
) -> Result<String, VaultError> {
    let bytes = serde_json::to_vec(&serde_json::json!({
        "policy": API_REQUEST_POLICY_REVISION,
        "environmentId": environment.id,
        "environmentRevision": environment.revision,
        "environmentPolicyDigest": environment.policy_digest,
        "request": input,
    }))
    .map_err(|_| VaultError::Serialization)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

pub(crate) fn canonical_api_request_path(value: &str) -> Result<String, VaultError> {
    if value.is_empty()
        || value.len() > 2_048
        || !value.starts_with('/')
        || value.starts_with("//")
        || !value.is_ascii()
        || value.contains(['\\', '?', '#', '*'])
        || value.chars().any(char::is_control)
    {
        return Err(VaultError::InvalidApiRequest);
    }
    let bytes = value.as_bytes();
    let mut canonical = String::with_capacity(value.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            canonical.push(char::from(bytes[index]));
            index += 1;
            continue;
        }
        if index + 2 >= bytes.len() {
            return Err(VaultError::InvalidApiRequest);
        }
        let high = hex_value(bytes[index + 1]).ok_or(VaultError::InvalidApiRequest)?;
        let low = hex_value(bytes[index + 2]).ok_or(VaultError::InvalidApiRequest)?;
        let decoded = high * 16 + low;
        if matches!(decoded, b'/' | b'\\' | b'.' | 0) || decoded.is_ascii_control() {
            return Err(VaultError::InvalidApiRequest);
        }
        canonical.push('%');
        canonical.push(hex_upper(high));
        canonical.push(hex_upper(low));
        index += 3;
    }
    if canonical != "/"
        && canonical
            .split('/')
            .skip(1)
            .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
    {
        return Err(VaultError::InvalidApiRequest);
    }
    Ok(canonical)
}

fn join_api_base_path(base_path: Option<&str>, path: &str) -> Result<String, VaultError> {
    let Some(base_path) = base_path.filter(|value| !value.is_empty()) else {
        return Ok(path.to_owned());
    };
    let base = canonical_api_request_path(base_path)?;
    if path == "/" {
        Ok(base)
    } else {
        canonical_api_request_path(&format!("{}{}", base.trim_end_matches('/'), path))
    }
}

fn validate_json_shape(value: &Value, depth: usize, items: &mut usize) -> Result<(), VaultError> {
    if depth > MAX_API_REQUEST_JSON_DEPTH {
        return Err(VaultError::InvalidApiRequest);
    }
    match value {
        Value::Array(values) => {
            *items = items.saturating_add(values.len());
            if *items > MAX_API_REQUEST_JSON_ITEMS {
                return Err(VaultError::InvalidApiRequest);
            }
            for value in values {
                validate_json_shape(value, depth + 1, items)?;
            }
        }
        Value::Object(values) => {
            *items = items.saturating_add(values.len());
            if *items > MAX_API_REQUEST_JSON_ITEMS {
                return Err(VaultError::InvalidApiRequest);
            }
            for value in values.values() {
                validate_json_shape(value, depth + 1, items)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn hex_upper(value: u8) -> char {
    char::from(if value < 10 {
        b'0' + value
    } else {
        b'A' + value - 10
    })
}
