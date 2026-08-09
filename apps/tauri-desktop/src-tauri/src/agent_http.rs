use std::{
    collections::BTreeMap,
    net::{IpAddr, SocketAddr, ToSocketAddrs},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{RecvTimeoutError, sync_channel},
    },
    time::Duration,
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use reqwest::{
    Method, Url,
    header::{ACCEPT, CONTENT_TYPE},
    redirect::Policy,
    tls::TlsInfo,
};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use vaultmesh_ffi::{AgentHttpBodyMode, AgentHttpOperationPolicy};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(12);
const CANCELLATION_POLL: Duration = Duration::from_millis(25);
const MAX_RESOLVED_ADDRESSES: usize = 16;
pub(crate) enum AgentHttpAuthentication {
    Bearer(Zeroizing<String>),
}

impl AgentHttpAuthentication {
    fn canaries(&self) -> Vec<String> {
        let Self::Bearer(token) = self;
        vec![token.to_string()]
    }
}

pub(crate) struct AgentHttpRequestPlan {
    pub origin: String,
    pub operation: AgentHttpOperationPolicy,
    pub input: Value,
    pub authentication: AgentHttpAuthentication,
    pub tls_spki_sha256: Vec<String>,
    pub allowed_output_fields: Vec<String>,
    pub max_output_bytes: usize,
    pub max_output_items: usize,
    pub discard_response_body: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct AgentHttpError {
    pub code: &'static str,
}

impl AgentHttpError {
    fn new(code: &'static str) -> Self {
        Self { code }
    }
}

pub(crate) fn execute_agent_request(
    plan: AgentHttpRequestPlan,
    cancellation: &AtomicBool,
) -> Result<Value, AgentHttpError> {
    execute_agent_request_with_root(plan, cancellation, None)
}

fn execute_agent_request_with_root(
    plan: AgentHttpRequestPlan,
    cancellation: &AtomicBool,
    test_root: Option<reqwest::Certificate>,
) -> Result<Value, AgentHttpError> {
    if cancellation.load(Ordering::Acquire) {
        return Err(AgentHttpError::new("session-cancelled"));
    }
    let (sender, receiver) = sync_channel(1);
    let worker = tauri::async_runtime::spawn(async move {
        let result = execute_agent_request_async_with_root(plan, test_root).await;
        let _ = sender.send(result);
    });
    loop {
        if cancellation.load(Ordering::Acquire) {
            worker.abort();
            return Err(AgentHttpError::new("session-cancelled"));
        }
        match receiver.recv_timeout(CANCELLATION_POLL) {
            Ok(result) => {
                if cancellation.load(Ordering::Acquire) {
                    return Err(AgentHttpError::new("session-cancelled"));
                }
                return result;
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                return Err(AgentHttpError::new("http-operation-failed"));
            }
        }
    }
}

async fn execute_agent_request_async_with_root(
    plan: AgentHttpRequestPlan,
    test_root: Option<reqwest::Certificate>,
) -> Result<Value, AgentHttpError> {
    let (url, host, addresses) = resolve_bound_target(&plan.origin, &plan.operation.path)?;
    let method = Method::from_bytes(plan.operation.method.as_bytes())
        .map_err(|_| AgentHttpError::new("http-policy-invalid"))?;
    let input = validate_input(&plan.operation, &plan.input)?;
    let mut client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .no_proxy()
        .redirect(Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .pool_max_idle_per_host(0)
        .tls_info(!plan.tls_spki_sha256.is_empty())
        .resolve_to_addrs(&host, &addresses);
    if let Some(root) = test_root {
        client = client.add_root_certificate(root);
    }
    let client = client
        .build()
        .map_err(|_| AgentHttpError::new("http-client-unavailable"))?;
    let authentication = resolve_authentication(&plan.authentication).await?;
    let mut request = client
        .request(method.clone(), url)
        .header(ACCEPT, "application/json");
    request = attach_authentication(request, &authentication);
    if matches!(method, Method::GET | Method::HEAD) {
        request = request.query(&input);
    } else if plan.operation.request_mode != AgentHttpBodyMode::Empty {
        request = request.json(&input);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| AgentHttpError::new("http-operation-failed"))?;
    verify_tls_pins(&response, &plan.tls_spki_sha256)?;
    let status = response.status();
    if status.is_redirection() {
        return Err(AgentHttpError::new("http-redirect-denied"));
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .unwrap_or("");
    let accepts_empty = method == Method::HEAD || plan.operation.response_fields.is_empty();
    if !accepts_empty && content_type != "application/json" && !content_type.ends_with("+json") {
        return Err(AgentHttpError::new("http-response-schema-invalid"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| AgentHttpError::new("http-operation-failed"))?
    {
        if bytes.len().saturating_add(chunk.len()) > plan.max_output_bytes {
            return Err(AgentHttpError::new("http-response-too-large"));
        }
        bytes.extend_from_slice(&chunk);
    }
    let response_canaries = authentication.canaries.clone();
    if contains_secret_representation(&bytes, &response_canaries) {
        return Err(AgentHttpError::new("http-response-secret-detected"));
    }
    let body = if plan.discard_response_body || (bytes.is_empty() && accepts_empty) {
        Value::Object(Map::new())
    } else {
        serde_json::from_slice::<Value>(&bytes)
            .map_err(|_| AgentHttpError::new("http-response-schema-invalid"))?
    };
    let canaries = response_canaries;
    build_safe_response(
        status.as_u16(),
        body,
        &plan.operation.response_fields,
        &plan.allowed_output_fields,
        plan.max_output_bytes,
        plan.max_output_items,
        &canaries,
    )
}

struct ResolvedAuthentication {
    authorization: Zeroizing<String>,
    canaries: Vec<String>,
}

async fn resolve_authentication(
    authentication: &AgentHttpAuthentication,
) -> Result<ResolvedAuthentication, AgentHttpError> {
    let AgentHttpAuthentication::Bearer(token) = authentication;
    Ok(ResolvedAuthentication {
        authorization: Zeroizing::new(token.to_string()),
        canaries: authentication.canaries(),
    })
}

fn attach_authentication(
    request: reqwest::RequestBuilder,
    authentication: &ResolvedAuthentication,
) -> reqwest::RequestBuilder {
    request.bearer_auth(authentication.authorization.as_str())
}

fn contains_secret_representation(bytes: &[u8], canaries: &[String]) -> bool {
    canaries
        .iter()
        .filter(|canary| !canary.is_empty())
        .any(|canary| {
            let encoded = STANDARD.encode(canary.as_bytes());
            let hex = canary
                .as_bytes()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            [canary.as_bytes(), encoded.as_bytes(), hex.as_bytes()]
                .iter()
                .any(|needle| bytes.windows(needle.len()).any(|window| window == *needle))
        })
}

fn validate_input(
    operation: &AgentHttpOperationPolicy,
    input: &Value,
) -> Result<BTreeMap<String, Value>, AgentHttpError> {
    let object = input
        .as_object()
        .ok_or_else(|| AgentHttpError::new("http-request-schema-invalid"))?;
    if object
        .keys()
        .any(|key| !operation.request_fields.contains(key))
    {
        return Err(AgentHttpError::new("http-request-schema-invalid"));
    }
    Ok(object
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect())
}

fn resolve_bound_target(
    origin: &str,
    path: &str,
) -> Result<(Url, String, Vec<SocketAddr>), AgentHttpError> {
    let base = Url::parse(origin).map_err(|_| AgentHttpError::new("http-policy-invalid"))?;
    if !matches!(base.scheme(), "http" | "https")
        || base.username() != ""
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
        || base.path() != "/"
    {
        return Err(AgentHttpError::new("http-policy-invalid"));
    }
    let host = base
        .host_str()
        .ok_or_else(|| AgentHttpError::new("http-policy-invalid"))?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    let port = base
        .port_or_known_default()
        .ok_or_else(|| AgentHttpError::new("http-policy-invalid"))?;
    let url = base
        .join(path)
        .map_err(|_| AgentHttpError::new("http-policy-invalid"))?;
    if url.origin() != base.origin() || url.path() != path || url.query().is_some() {
        return Err(AgentHttpError::new("http-policy-invalid"));
    }
    let mut addresses = if let Ok(ip) = host.parse::<IpAddr>() {
        vec![SocketAddr::new(ip, port)]
    } else {
        (host.as_str(), port)
            .to_socket_addrs()
            .map_err(|_| AgentHttpError::new("http-dns-failed"))?
            .take(MAX_RESOLVED_ADDRESSES + 1)
            .collect::<Vec<_>>()
    };
    addresses.sort_unstable();
    addresses.dedup();
    if addresses.is_empty() || addresses.len() > MAX_RESOLVED_ADDRESSES {
        return Err(AgentHttpError::new("http-dns-failed"));
    }
    Ok((url, host, addresses))
}

fn verify_tls_pins(response: &reqwest::Response, pins: &[String]) -> Result<(), AgentHttpError> {
    if pins.is_empty() {
        return Ok(());
    }
    let certificate = response
        .extensions()
        .get::<TlsInfo>()
        .and_then(TlsInfo::peer_certificate)
        .ok_or_else(|| AgentHttpError::new("http-tls-pin-unavailable"))?;
    let spki = certificate_spki(certificate)
        .ok_or_else(|| AgentHttpError::new("http-tls-pin-unavailable"))?;
    let digest = format!("sha256:{:x}", Sha256::digest(spki));
    if pins.iter().any(|pin| pin == &digest) {
        Ok(())
    } else {
        Err(AgentHttpError::new("http-tls-pin-mismatch"))
    }
}

#[derive(Clone, Copy)]
struct DerTlv {
    tag: u8,
    start: usize,
    content_start: usize,
    end: usize,
}

fn der_tlv(input: &[u8], start: usize) -> Option<DerTlv> {
    let tag = *input.get(start)?;
    let first_length = *input.get(start + 1)?;
    let (length, content_start) = if first_length & 0x80 == 0 {
        (usize::from(first_length), start.checked_add(2)?)
    } else {
        let length_bytes = usize::from(first_length & 0x7f);
        if length_bytes == 0 || length_bytes > std::mem::size_of::<usize>() {
            return None;
        }
        let mut length = 0_usize;
        for byte in input.get(start + 2..start + 2 + length_bytes)? {
            length = length.checked_mul(256)?.checked_add(usize::from(*byte))?;
        }
        (length, start.checked_add(2 + length_bytes)?)
    };
    let end = content_start.checked_add(length)?;
    (end <= input.len()).then_some(DerTlv {
        tag,
        start,
        content_start,
        end,
    })
}

fn certificate_spki(certificate: &[u8]) -> Option<&[u8]> {
    let outer = der_tlv(certificate, 0)?;
    if outer.tag != 0x30 || outer.end != certificate.len() {
        return None;
    }
    let tbs = der_tlv(certificate, outer.content_start)?;
    if tbs.tag != 0x30 || tbs.end > outer.end {
        return None;
    }
    let mut cursor = tbs.content_start;
    if der_tlv(certificate, cursor)?.tag == 0xa0 {
        cursor = der_tlv(certificate, cursor)?.end;
    }
    for _ in 0..5 {
        cursor = der_tlv(certificate, cursor)?.end;
    }
    let spki = der_tlv(certificate, cursor)?;
    (spki.tag == 0x30 && spki.end <= tbs.end).then(|| &certificate[spki.start..spki.end])
}

fn build_safe_response(
    status: u16,
    body: Value,
    operation_fields: &[String],
    allowed_fields: &[String],
    maximum_bytes: usize,
    maximum_items: usize,
    canaries: &[String],
) -> Result<Value, AgentHttpError> {
    let object = body
        .as_object()
        .ok_or_else(|| AgentHttpError::new("http-response-schema-invalid"))?;
    let mut truncated = false;
    let wildcard = operation_fields == ["*"] && allowed_fields == ["*"];
    let fields = if wildcard {
        let mut remaining_items = maximum_items;
        sanitize_untrusted_object(object, 0, &mut remaining_items, &mut truncated)?
    } else {
        let mut fields = Map::new();
        for field in operation_fields {
            if !allowed_fields.contains(field) {
                continue;
            }
            if let Some(value) = object.get(field) {
                let mut value = value.clone();
                if let Some(items) = value.as_array_mut()
                    && items.len() > maximum_items
                {
                    items.truncate(maximum_items);
                    truncated = true;
                }
                fields.insert(field.clone(), value);
            }
        }
        fields
    };
    let encoded = serde_json::to_vec(&fields)
        .map_err(|_| AgentHttpError::new("http-response-schema-invalid"))?;
    if encoded.len() > maximum_bytes {
        return Err(AgentHttpError::new("http-response-too-large"));
    }
    let text = String::from_utf8_lossy(&encoded);
    if contains_canary(&text, canaries) {
        return Err(AgentHttpError::new("http-response-secret-detected"));
    }
    Ok(json!({
        "status": status,
        "statusClass": format!("{}xx", status / 100),
        "fields": fields,
        "truncated": truncated,
    }))
}

fn sanitize_untrusted_object(
    object: &Map<String, Value>,
    depth: usize,
    remaining_items: &mut usize,
    truncated: &mut bool,
) -> Result<Map<String, Value>, AgentHttpError> {
    if depth > 16 {
        return Err(AgentHttpError::new("http-response-schema-invalid"));
    }
    let mut sanitized = Map::new();
    for (key, value) in object {
        if is_sensitive_response_key(key) {
            sanitized.insert(key.clone(), Value::String("[REDACTED]".to_owned()));
            continue;
        }
        sanitized.insert(
            key.clone(),
            sanitize_untrusted_value(value, depth + 1, remaining_items, truncated)?,
        );
    }
    Ok(sanitized)
}

fn sanitize_untrusted_value(
    value: &Value,
    depth: usize,
    remaining_items: &mut usize,
    truncated: &mut bool,
) -> Result<Value, AgentHttpError> {
    if depth > 16 {
        return Err(AgentHttpError::new("http-response-schema-invalid"));
    }
    match value {
        Value::Object(object) => Ok(Value::Object(sanitize_untrusted_object(
            object,
            depth,
            remaining_items,
            truncated,
        )?)),
        Value::Array(items) => {
            let take = items.len().min(*remaining_items);
            if take < items.len() {
                *truncated = true;
            }
            *remaining_items = remaining_items.saturating_sub(take);
            items
                .iter()
                .take(take)
                .map(|item| sanitize_untrusted_value(item, depth + 1, remaining_items, truncated))
                .collect::<Result<Vec<_>, _>>()
                .map(Value::Array)
        }
        _ => Ok(value.clone()),
    }
}

fn is_sensitive_response_key(key: &str) -> bool {
    let normalized = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    [
        "authorization",
        "accesstoken",
        "refreshtoken",
        "idtoken",
        "clientsecret",
        "password",
        "passphrase",
        "privatekey",
        "recoverycode",
        "setcookie",
        "otp",
    ]
    .iter()
    .any(|sensitive| normalized.contains(sensitive))
}

fn contains_canary(output: &str, canaries: &[String]) -> bool {
    canaries
        .iter()
        .filter(|canary| !canary.is_empty())
        .any(|canary| {
            let encoded = STANDARD.encode(canary.as_bytes());
            let hex = canary
                .as_bytes()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            [canary.as_str(), encoded.as_str(), hex.as_str()]
                .iter()
                .any(|representation| output.contains(representation))
        })
}

#[cfg(test)]
#[path = "agent_http_tests.rs"]
mod tests;
