use super::*;
use std::{
    collections::HashMap,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU8, Ordering},
        mpsc::{RecvTimeoutError, sync_channel},
    },
};

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use reqwest::{
    Method, Url,
    header::{CONTENT_ENCODING, CONTENT_TYPE, HeaderName, HeaderValue},
    redirect::Policy,
};
use uuid::Uuid;
use vaultmesh_ffi::{
    ApiKeyLocation, ApiRequestAuthenticationMaterial, ApiRequestBodyInput, ApiRequestExecutionPlan,
    ApiRequestInput, ApiRequestPlanSummary,
};

const PREPARED_TTL_MILLIS: u64 = 60_000;
const MAX_PREPARED_REQUESTS: usize = 4;
const MAX_ACTIVE_REQUESTS: usize = 2;
const MAX_RESOLVED_ADDRESSES: usize = 16;
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_RESPONSE_HEADERS: usize = 64;
const MAX_RESPONSE_HEADER_BYTES: usize = 16 * 1024;
const MAX_RESPONSE_JSON_DEPTH: usize = 16;
const MAX_RESPONSE_JSON_ITEMS: usize = 2_048;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const CANCELLATION_POLL: Duration = Duration::from_millis(25);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum ApiTargetClass {
    Public,
    Private,
    Loopback,
}

#[derive(Clone, Debug)]
struct BoundApiTarget {
    url: Url,
    host: String,
    addresses: Vec<SocketAddr>,
    class: ApiTargetClass,
    cleartext: bool,
}

struct PreparedApiRequest {
    summary: ApiRequestPlanSummary,
    input: Zeroizing<Vec<u8>>,
    target: BoundApiTarget,
    cancellation: Arc<AtomicBool>,
    expires_at: u64,
    active: bool,
}

pub(super) struct ActiveApiRequest {
    execution_ref: Uuid,
    summary: ApiRequestPlanSummary,
    input: Zeroizing<Vec<u8>>,
    target: BoundApiTarget,
    cancellation: Arc<AtomicBool>,
}

#[derive(Default)]
pub(super) struct DesktopApiRequestStore {
    prepared: HashMap<Uuid, PreparedApiRequest>,
}

impl DesktopApiRequestStore {
    fn prune(&mut self, now: u64) {
        self.prepared.retain(|_, request| {
            let keep = request.active || request.expires_at > now;
            if !keep {
                request.cancellation.store(true, Ordering::Release);
            }
            keep
        });
    }

    fn insert(
        &mut self,
        summary: ApiRequestPlanSummary,
        input: Vec<u8>,
        target: BoundApiTarget,
        now: u64,
    ) -> Result<(Uuid, u64), &'static str> {
        self.prune(now);
        if self.prepared.len() >= MAX_PREPARED_REQUESTS {
            return Err("api-request-quota");
        }
        let execution_ref = Uuid::new_v4();
        let expires_at = now.saturating_add(PREPARED_TTL_MILLIS);
        self.prepared.insert(
            execution_ref,
            PreparedApiRequest {
                summary,
                input: Zeroizing::new(input),
                target,
                cancellation: Arc::new(AtomicBool::new(false)),
                expires_at,
                active: false,
            },
        );
        Ok((execution_ref, expires_at))
    }

    fn begin(&mut self, execution_ref: Uuid, now: u64) -> Result<ActiveApiRequest, &'static str> {
        self.prune(now);
        if self
            .prepared
            .values()
            .filter(|request| request.active)
            .count()
            >= MAX_ACTIVE_REQUESTS
        {
            return Err("api-request-quota");
        }
        let request = self
            .prepared
            .get_mut(&execution_ref)
            .ok_or("api-request-expired")?;
        if request.active || request.expires_at <= now {
            return Err("api-request-expired");
        }
        request.active = true;
        Ok(ActiveApiRequest {
            execution_ref,
            summary: request.summary.clone(),
            input: Zeroizing::new(request.input.to_vec()),
            target: request.target.clone(),
            cancellation: Arc::clone(&request.cancellation),
        })
    }

    fn finish(&mut self, execution_ref: Uuid) {
        if let Some(request) = self.prepared.remove(&execution_ref) {
            request.cancellation.store(true, Ordering::Release);
        }
    }

    fn cancel(&mut self, execution_ref: Uuid) -> bool {
        let Some(request) = self.prepared.get(&execution_ref) else {
            return false;
        };
        request.cancellation.store(true, Ordering::Release);
        if !request.active {
            self.prepared.remove(&execution_ref);
        }
        true
    }

    pub(super) fn clear(&mut self) {
        for request in self.prepared.values() {
            request.cancellation.store(true, Ordering::Release);
        }
        self.prepared.clear();
    }
}

impl Drop for DesktopApiRequestStore {
    fn drop(&mut self) {
        self.clear();
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExecutionRefInput {
    execution_ref: Uuid,
}

pub(super) async fn prepare_desktop_api_request(
    state: &RuntimeState,
    input: Value,
) -> Result<Value, String> {
    let request: ApiRequestInput =
        serde_json::from_value(input).map_err(|_| "请求参数无效。".to_owned())?;
    let stored = serde_json::to_vec(&request).map_err(|_| "请求参数无效。".to_owned())?;
    let summary = with_runtime(state, move |runtime| runtime.prepare_api_request(request)).await?;
    let target_summary = summary.clone();
    let target =
        tauri::async_runtime::spawn_blocking(move || resolve_bound_target(&target_summary))
            .await
            .map_err(|_| "无法解析 API 目标。".to_owned())?
            .map_err(|error| safe_prepare_message(error).to_owned())?;
    let target_class = target.class;
    let cleartext = target.cleartext;
    let now = unix_millis();
    let (execution_ref, expires_at) = state
        .api_requests
        .lock()
        .map_err(|_| "API 请求工作台暂时不可用。".to_owned())?
        .insert(summary.clone(), stored, target, now)
        .map_err(|code| safe_prepare_message(code).to_owned())?;
    Ok(json!({
        "executionRef": execution_ref,
        "expiresAt": expires_at,
        "method": summary.method,
        "origin": summary.origin,
        "basePath": summary.base_path,
        "path": summary.path,
        "bodyType": summary.body_type,
        "queryCount": summary.query_count,
        "requestHeaderCount": summary.request_header_count,
        "fixedHeaderCount": summary.fixed_header_count,
        "authType": summary.auth_type,
        "targetClass": target_class,
        "mutation": summary.mutation,
        "requiresNativeConfirmation": summary.mutation || target_class != ApiTargetClass::Public || cleartext,
    }))
}

pub(super) async fn execute_desktop_api_request(
    app: &AppHandle,
    state: &RuntimeState,
    input: Value,
) -> Result<Value, String> {
    let input: ExecutionRefInput =
        serde_json::from_value(input).map_err(|_| "请求参数无效。".to_owned())?;
    let active = state
        .api_requests
        .lock()
        .map_err(|_| "API 请求工作台暂时不可用。".to_owned())?
        .begin(input.execution_ref, unix_millis())
        .map_err(|code| safe_prepare_message(code).to_owned())?;

    let result = execute_active_request(app, state, &active).await;
    if let Ok(mut requests) = state.api_requests.lock() {
        requests.finish(active.execution_ref);
    }
    Ok(result)
}

async fn execute_active_request(
    app: &AppHandle,
    state: &RuntimeState,
    active: &ActiveApiRequest,
) -> Value {
    if requires_native_confirmation(&active.summary, &active.target) {
        let app_for_dialog = app.clone();
        let summary = active.summary.clone();
        let target_class = active.target.class;
        let dialog_guard = state.native_dialog_focus.begin();
        let confirmed = tauri::async_runtime::spawn_blocking(move || {
            let _dialog_guard = dialog_guard;
            app_for_dialog
                .dialog()
                .message(format!(
                    "{} {}{}\n\n目标类别：{}。VaultMesh 不会自动重试此请求。",
                    summary.method,
                    summary.origin,
                    summary.path,
                    target_class_label(target_class),
                ))
                .title(if summary.mutation {
                    "确认发送 API mutation？"
                } else {
                    "确认访问非公共 API 目标？"
                })
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "发送请求".into(),
                    "取消".into(),
                ))
                .blocking_show()
        })
        .await
        .unwrap_or(false);
        if !confirmed {
            return execution_error("cancelled", "user-cancelled", "请求已取消。", false);
        }
    }
    if active.cancellation.load(Ordering::Acquire) {
        return execution_error("cancelled", "request-cancelled", "请求已取消。", false);
    }

    let request: ApiRequestInput = match serde_json::from_slice(active.input.as_slice()) {
        Ok(request) => request,
        Err(_) => return execution_error("failed", "request-invalid", "请求参数无效。", false),
    };
    let runtime = Arc::clone(&state.runtime);
    let revision = active.summary.environment_revision;
    let policy_digest = active.summary.environment_policy_digest.clone();
    let request_digest = active.summary.request_digest.clone();
    let plan = match tauri::async_runtime::spawn_blocking(move || {
        let mut runtime = runtime
            .lock()
            .map_err(|_| DesktopRuntimeError::from(VAULTMESH_STATUS_CORE_ERROR))?;
        runtime.compile_api_request(request, revision, &policy_digest, &request_digest)
    })
    .await
    {
        Ok(Ok(plan)) => plan,
        Ok(Err(error)) if error.status() == VAULTMESH_STATUS_CONFLICT => {
            return execution_error(
                "failed",
                "profile-changed",
                "API 环境或凭据已变化，请重新预览。",
                false,
            );
        }
        Ok(Err(error)) if error.status() == VAULTMESH_STATUS_LOCKED => {
            return execution_error("cancelled", "vault-locked", "保险库已锁定。", false);
        }
        _ => {
            return execution_error(
                "failed",
                "plan-unavailable",
                "无法安全编译 API 请求。",
                false,
            );
        }
    };
    if plan.summary != active.summary || active.cancellation.load(Ordering::Acquire) {
        return execution_error(
            "cancelled",
            "request-cancelled",
            "请求已取消或环境已变化。",
            false,
        );
    }

    let target = active.target.clone();
    let cancellation = Arc::clone(&active.cancellation);
    match tauri::async_runtime::spawn_blocking(move || {
        execute_api_request(plan, target, cancellation.as_ref())
    })
    .await
    {
        Ok(Ok(response)) => json!({ "state": "completed", "response": response }),
        Ok(Err(error)) => execution_error(
            error.state,
            error.code,
            error.message,
            error.state == "execution-unknown",
        ),
        Err(_) => execution_error(
            "failed",
            "executor-unavailable",
            "API 请求执行失败。",
            false,
        ),
    }
}

pub(super) fn cancel_desktop_api_request(
    state: &RuntimeState,
    input: Value,
) -> Result<Value, String> {
    let input: ExecutionRefInput =
        serde_json::from_value(input).map_err(|_| "请求参数无效。".to_owned())?;
    let cancelled = state
        .api_requests
        .lock()
        .map_err(|_| "API 请求工作台暂时不可用。".to_owned())?
        .cancel(input.execution_ref);
    Ok(json!({ "cancelled": cancelled }))
}

fn requires_native_confirmation(summary: &ApiRequestPlanSummary, target: &BoundApiTarget) -> bool {
    summary.mutation || target.class != ApiTargetClass::Public || target.cleartext
}

pub(super) fn operation_invalidates_api_requests(operation: &str) -> bool {
    matches!(
        operation,
        "items.add"
            | "items.update"
            | "items.delete"
            | "items.trash.restore"
            | "items.trash.purge"
            | "items.trash.empty"
            | "items.history.restore"
            | "items.history.clear"
            | "secrets.add"
            | "secrets.update"
            | "secrets.delete"
            | "services.add"
            | "services.update"
            | "services.delete"
            | "services.link"
            | "services.unlink"
            | "services.move"
            | "services.merge"
            | "services.split"
            | "services.trash.restore"
            | "services.trash.purge"
            | "services.trash.empty"
            | "services.history.restore"
            | "services.history.clear"
            | "services.aggregation.apply"
            | "services.aggregation.rollback"
            | "api-environments.add"
            | "api-environments.update"
            | "api-environments.delete"
            | "api-environments.trash.restore"
            | "api-environments.trash.purge"
            | "api-environments.history.restore"
            | "api-environments.history.clear"
    )
}

fn resolve_bound_target(summary: &ApiRequestPlanSummary) -> Result<BoundApiTarget, &'static str> {
    let base = Url::parse(&summary.origin).map_err(|_| "api-target-invalid")?;
    if !matches!(base.scheme(), "http" | "https")
        || !base.username().is_empty()
        || base.password().is_some()
        || base.path() != "/"
        || base.query().is_some()
        || base.fragment().is_some()
    {
        return Err("api-target-invalid");
    }
    let host = base
        .host_str()
        .ok_or("api-target-invalid")?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    let port = base.port_or_known_default().ok_or("api-target-invalid")?;
    let url = base.join(&summary.path).map_err(|_| "api-target-invalid")?;
    if url.origin() != base.origin() || url.path() != summary.path || url.query().is_some() {
        return Err("api-target-invalid");
    }
    let mut addresses = if let Ok(ip) = host.parse::<IpAddr>() {
        vec![SocketAddr::new(ip, port)]
    } else {
        (host.as_str(), port)
            .to_socket_addrs()
            .map_err(|_| "api-dns-failed")?
            .take(MAX_RESOLVED_ADDRESSES + 1)
            .collect::<Vec<_>>()
    };
    addresses.sort_unstable();
    addresses.dedup();
    if addresses.is_empty() || addresses.len() > MAX_RESOLVED_ADDRESSES {
        return Err("api-dns-failed");
    }
    let mut class = None;
    for address in &addresses {
        let next = classify_target(address.ip())?;
        if class.is_some_and(|current| current != next) {
            return Err("api-dns-mixed-target");
        }
        class = Some(next);
    }
    let class = class.ok_or("api-dns-failed")?;
    let cleartext = base.scheme() == "http";
    if cleartext && class == ApiTargetClass::Public {
        return Err("api-public-http-denied");
    }
    Ok(BoundApiTarget {
        url,
        host,
        addresses,
        class,
        cleartext,
    })
}

fn classify_target(ip: IpAddr) -> Result<ApiTargetClass, &'static str> {
    match ip {
        IpAddr::V4(ip) => classify_ipv4(ip),
        IpAddr::V6(ip) => {
            if let Some(mapped) = ip.to_ipv4_mapped() {
                return classify_ipv4(mapped);
            }
            if ip == Ipv6Addr::LOCALHOST {
                return Ok(ApiTargetClass::Loopback);
            }
            let segments = ip.segments();
            if ip.is_unspecified()
                || ip.is_multicast()
                || (segments[0] & 0xffc0) == 0xfe80
                || ip
                    == "fd00:ec2::254"
                        .parse::<Ipv6Addr>()
                        .expect("metadata literal")
            {
                return Err("api-target-denied");
            }
            if (segments[0] & 0xfe00) == 0xfc00 {
                Ok(ApiTargetClass::Private)
            } else {
                Ok(ApiTargetClass::Public)
            }
        }
    }
}

fn classify_ipv4(ip: Ipv4Addr) -> Result<ApiTargetClass, &'static str> {
    let octets = ip.octets();
    if ip == Ipv4Addr::new(169, 254, 169, 254)
        || ip == Ipv4Addr::new(100, 100, 100, 200)
        || ip == Ipv4Addr::new(192, 0, 0, 192)
        || ip.is_unspecified()
        || ip.is_multicast()
        || ip.is_link_local()
        || ip == Ipv4Addr::BROADCAST
        || octets[0] == 0
    {
        return Err("api-target-denied");
    }
    if ip.is_loopback() {
        return Ok(ApiTargetClass::Loopback);
    }
    if ip.is_private() || (octets[0] == 100 && (64..=127).contains(&octets[1])) {
        return Ok(ApiTargetClass::Private);
    }
    Ok(ApiTargetClass::Public)
}

#[derive(Clone, Copy, Debug)]
struct ApiExecutionError {
    state: &'static str,
    code: &'static str,
    message: &'static str,
}

fn execute_api_request(
    plan: ApiRequestExecutionPlan,
    target: BoundApiTarget,
    cancellation: &AtomicBool,
) -> Result<Value, ApiExecutionError> {
    if cancellation.load(Ordering::Acquire) {
        return Err(cancelled_error(plan.summary.mutation, false));
    }
    let sent_phase = Arc::new(AtomicU8::new(0));
    let worker_phase = Arc::clone(&sent_phase);
    let mutation = plan.summary.mutation;
    let (sender, receiver) = sync_channel(1);
    let worker = tauri::async_runtime::spawn(async move {
        let result = execute_api_request_async(plan, target, worker_phase.as_ref()).await;
        let _ = sender.send(result);
    });
    loop {
        if cancellation.load(Ordering::Acquire) {
            worker.abort();
            return Err(cancelled_error(
                mutation,
                sent_phase.load(Ordering::Acquire) > 0,
            ));
        }
        match receiver.recv_timeout(CANCELLATION_POLL) {
            Ok(result) => return result,
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                return Err(ApiExecutionError {
                    state: if mutation && sent_phase.load(Ordering::Acquire) > 0 {
                        "execution-unknown"
                    } else {
                        "failed"
                    },
                    code: "executor-unavailable",
                    message: "API 请求执行失败。",
                });
            }
        }
    }
}

async fn execute_api_request_async(
    plan: ApiRequestExecutionPlan,
    mut target: BoundApiTarget,
    sent_phase: &AtomicU8,
) -> Result<Value, ApiExecutionError> {
    let method = Method::from_bytes(plan.summary.method.as_bytes()).map_err(|_| invalid_plan())?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .pool_max_idle_per_host(0)
        .http1_only()
        .resolve_to_addrs(&target.host, &target.addresses)
        .build()
        .map_err(|_| ApiExecutionError {
            state: "failed",
            code: "client-unavailable",
            message: "API 网络客户端不可用。",
        })?;

    {
        let mut query = target.url.query_pairs_mut();
        for pair in &plan.query {
            query.append_pair(&pair.name, pair.value.as_str());
        }
        if let ApiRequestAuthenticationMaterial::ApiKey {
            location: ApiKeyLocation::Query,
            name,
            value,
        } = &plan.authentication
        {
            query.append_pair(name, value.as_str());
        }
    }
    let mut request = client
        .request(method.clone(), target.url)
        .header("accept-encoding", "identity");
    let mut has_content_type = false;
    for header in &plan.headers {
        let name = HeaderName::from_bytes(header.name.as_bytes()).map_err(|_| invalid_plan())?;
        let value = HeaderValue::from_str(header.value.as_str()).map_err(|_| invalid_plan())?;
        if name == CONTENT_TYPE {
            has_content_type = true;
            validate_request_content_type(header.value.as_str(), &plan.body)?;
        }
        request = request.header(name, value);
    }
    request = match &plan.authentication {
        ApiRequestAuthenticationMaterial::None => request,
        ApiRequestAuthenticationMaterial::Bearer { token } => request.bearer_auth(token.as_str()),
        ApiRequestAuthenticationMaterial::Basic { username, password } => {
            request.basic_auth(username.as_str(), Some(password.as_str()))
        }
        ApiRequestAuthenticationMaterial::ApiKey {
            location: ApiKeyLocation::Header,
            name,
            value,
        } => request.header(
            HeaderName::from_bytes(name.as_bytes()).map_err(|_| invalid_plan())?,
            HeaderValue::from_str(value.as_str()).map_err(|_| invalid_plan())?,
        ),
        ApiRequestAuthenticationMaterial::ApiKey {
            location: ApiKeyLocation::Query,
            ..
        } => request,
    };
    request = match &plan.body {
        ApiRequestBodyInput::None => request,
        ApiRequestBodyInput::Json { value } => {
            let request = if has_content_type {
                request
            } else {
                request.header(CONTENT_TYPE, "application/json")
            };
            request.body(value.as_bytes().to_vec())
        }
        ApiRequestBodyInput::Text { value } => {
            let request = if has_content_type {
                request
            } else {
                request.header(CONTENT_TYPE, "text/plain; charset=utf-8")
            };
            request.body(value.as_bytes().to_vec())
        }
    };

    sent_phase.store(1, Ordering::Release);
    let mut response = match request.send().await {
        Ok(response) => response,
        Err(error) if error.is_connect() => {
            return Err(ApiExecutionError {
                state: "failed",
                code: "connect-failed",
                message: "无法连接 API 目标，请求未确认送达。",
            });
        }
        Err(error) if plan.summary.mutation => {
            return Err(ApiExecutionError {
                state: "execution-unknown",
                code: if error.is_timeout() {
                    "request-timeout"
                } else {
                    "transport-lost"
                },
                message: "请求可能已经送达；请在远端核对后再决定是否重试。",
            });
        }
        Err(error) => {
            return Err(ApiExecutionError {
                state: "failed",
                code: if error.is_timeout() {
                    "request-timeout"
                } else {
                    "transport-lost"
                },
                message: "API 请求未能完成。",
            });
        }
    };
    sent_phase.store(2, Ordering::Release);
    if response.status().is_redirection() {
        return Err(ApiExecutionError {
            state: "failed",
            code: "redirect-denied",
            message: "API 目标返回了不允许的重定向。",
        });
    }
    if response
        .headers()
        .get(CONTENT_ENCODING)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| !value.eq_ignore_ascii_case("identity"))
    {
        return Err(ApiExecutionError {
            state: "failed",
            code: "compressed-response-denied",
            message: "V1 工作台不接受压缩响应。",
        });
    }
    let headers = safe_response_headers(response.headers(), plan.canaries.as_slice())?;
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let status = response.status().as_u16();
    let mut bytes = Zeroizing::new(Vec::new());
    while let Some(chunk) = response.chunk().await.map_err(|_| ApiExecutionError {
        state: if plan.summary.mutation {
            "execution-unknown"
        } else {
            "failed"
        },
        code: "response-interrupted",
        message: if plan.summary.mutation {
            "请求已送达但响应中断；请在远端核对结果。"
        } else {
            "API 响应读取中断。"
        },
    })? {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(ApiExecutionError {
                state: "failed",
                code: "response-too-large",
                message: "API 响应超过 1 MiB 限制。",
            });
        }
        bytes.extend_from_slice(&chunk);
    }
    if contains_secret_representation(bytes.as_slice(), plan.canaries.as_slice()) {
        return Err(ApiExecutionError {
            state: "failed",
            code: "secret-detected",
            message: "响应可能包含已绑定凭据，正文已丢弃。",
        });
    }
    let body = parse_response_body(
        bytes.as_slice(),
        content_type.as_deref(),
        method == Method::HEAD,
    )?;
    Ok(json!({
        "status": status,
        "statusClass": format!("{}xx", status / 100),
        "headers": headers,
        "body": body,
    }))
}

fn validate_request_content_type(
    value: &str,
    body: &ApiRequestBodyInput,
) -> Result<(), ApiExecutionError> {
    let media = value
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let valid = match body {
        ApiRequestBodyInput::None => true,
        ApiRequestBodyInput::Json { .. } => media == "application/json" || media.ends_with("+json"),
        ApiRequestBodyInput::Text { .. } => media == "text/plain",
    };
    if valid { Ok(()) } else { Err(invalid_plan()) }
}

fn safe_response_headers(
    headers: &reqwest::header::HeaderMap,
    canaries: &[String],
) -> Result<Vec<Value>, ApiExecutionError> {
    let total_bytes = headers.iter().try_fold(0_usize, |total, (name, value)| {
        total
            .checked_add(name.as_str().len())?
            .checked_add(value.as_bytes().len())
    });
    if headers.len() > MAX_RESPONSE_HEADERS
        || total_bytes.is_none_or(|total| total > MAX_RESPONSE_HEADER_BYTES)
    {
        return Err(ApiExecutionError {
            state: "failed",
            code: "response-headers-too-large",
            message: "API 响应 Header 超过限制。",
        });
    }
    const ALLOWED: &[&str] = &[
        "content-type",
        "content-length",
        "content-language",
        "cache-control",
        "expires",
        "etag",
        "last-modified",
        "retry-after",
    ];
    let mut output = Vec::new();
    for (name, value) in headers {
        if !ALLOWED.contains(&name.as_str()) {
            continue;
        }
        let value = value.to_str().map_err(|_| ApiExecutionError {
            state: "failed",
            code: "response-header-invalid",
            message: "API 响应 Header 编码无效。",
        })?;
        if contains_secret_representation(value.as_bytes(), canaries) {
            return Err(ApiExecutionError {
                state: "failed",
                code: "secret-detected",
                message: "响应可能包含已绑定凭据，正文已丢弃。",
            });
        }
        output.push(json!({ "name": name.as_str(), "value": value }));
    }
    Ok(output)
}

fn parse_response_body(
    bytes: &[u8],
    content_type: Option<&str>,
    discard: bool,
) -> Result<Value, ApiExecutionError> {
    if discard || bytes.is_empty() {
        return Ok(json!({ "type": "empty" }));
    }
    let content_type = content_type.ok_or(ApiExecutionError {
        state: "failed",
        code: "response-content-type-required",
        message: "非空响应必须声明 JSON 或 UTF-8 text Content-Type。",
    })?;
    let mut parts = content_type.split(';');
    let media = parts.next().unwrap_or("").trim().to_ascii_lowercase();
    let charset_valid = parts.all(|part| {
        let part = part.trim().to_ascii_lowercase();
        !part.starts_with("charset=")
            || matches!(part.as_str(), "charset=utf-8" | "charset=\"utf-8\"")
    });
    if !charset_valid {
        return Err(ApiExecutionError {
            state: "failed",
            code: "response-encoding-denied",
            message: "只支持 UTF-8 API 响应。",
        });
    }
    if media == "application/json" || media.ends_with("+json") {
        let value = serde_json::from_slice::<Value>(bytes).map_err(|_| ApiExecutionError {
            state: "failed",
            code: "response-json-invalid",
            message: "API JSON 响应无效。",
        })?;
        let mut items = 0_usize;
        validate_response_json(&value, 0, &mut items)?;
        return Ok(json!({ "type": "json", "value": value }));
    }
    if media.starts_with("text/") {
        let value = std::str::from_utf8(bytes).map_err(|_| ApiExecutionError {
            state: "failed",
            code: "response-text-invalid",
            message: "API text 响应不是有效 UTF-8。",
        })?;
        return Ok(json!({ "type": "text", "value": value }));
    }
    Err(ApiExecutionError {
        state: "failed",
        code: "response-type-denied",
        message: "V1 工作台只接受 JSON 或 UTF-8 text 响应。",
    })
}

fn validate_response_json(
    value: &Value,
    depth: usize,
    items: &mut usize,
) -> Result<(), ApiExecutionError> {
    if depth > MAX_RESPONSE_JSON_DEPTH {
        return Err(ApiExecutionError {
            state: "failed",
            code: "response-json-too-deep",
            message: "API JSON 响应嵌套过深。",
        });
    }
    let children: Vec<&Value> = match value {
        Value::Array(values) => values.iter().collect(),
        Value::Object(values) => values.values().collect(),
        _ => return Ok(()),
    };
    *items = items.saturating_add(children.len());
    if *items > MAX_RESPONSE_JSON_ITEMS {
        return Err(ApiExecutionError {
            state: "failed",
            code: "response-json-too-large",
            message: "API JSON 响应项目过多。",
        });
    }
    for child in children {
        validate_response_json(child, depth + 1, items)?;
    }
    Ok(())
}

fn contains_secret_representation(bytes: &[u8], canaries: &[String]) -> bool {
    canaries
        .iter()
        .filter(|value| !value.is_empty())
        .any(|value| {
            let representations = [
                value.as_bytes().to_vec(),
                STANDARD.encode(value.as_bytes()).into_bytes(),
                URL_SAFE_NO_PAD.encode(value.as_bytes()).into_bytes(),
                value
                    .as_bytes()
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>()
                    .into_bytes(),
            ];
            representations.iter().any(|needle| {
                !needle.is_empty()
                    && bytes
                        .windows(needle.len())
                        .any(|window| window == needle.as_slice())
            })
        })
}

fn invalid_plan() -> ApiExecutionError {
    ApiExecutionError {
        state: "failed",
        code: "request-plan-invalid",
        message: "API 请求计划无效。",
    }
}

fn cancelled_error(mutation: bool, may_have_sent: bool) -> ApiExecutionError {
    if mutation && may_have_sent {
        ApiExecutionError {
            state: "execution-unknown",
            code: "request-cancelled",
            message: "取消时请求可能已经送达；请在远端核对后再决定是否重试。",
        }
    } else {
        ApiExecutionError {
            state: "cancelled",
            code: "request-cancelled",
            message: "请求已取消。",
        }
    }
}

fn execution_error(state: &str, code: &str, message: &str, execution_unknown: bool) -> Value {
    json!({
        "state": state,
        "error": {
            "code": code,
            "message": message,
            "retryable": false,
            "executionUnknown": execution_unknown,
        }
    })
}

fn safe_prepare_message(code: &str) -> &'static str {
    match code {
        "api-request-quota" => "API 请求工作台并发数已达上限。",
        "api-request-expired" => "API 请求预览已过期或已使用，请重新预览。",
        "api-public-http-denied" => "公共 API 目标必须使用有效 HTTPS。",
        "api-target-denied" | "api-dns-mixed-target" => "该 API 目标地址类别不允许执行。",
        "api-dns-failed" => "无法安全解析 API 目标。",
        _ => "API 目标无效或不受支持。",
    }
}

fn target_class_label(class: ApiTargetClass) -> &'static str {
    match class {
        ApiTargetClass::Public => "公共网络",
        ApiTargetClass::Private => "私有网络",
        ApiTargetClass::Loopback => "本机 loopback",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vaultmesh_ffi::{ApiRequestAuthenticationMaterial, ApiRequestValueMaterial};

    fn summary(origin: &str, method: &str) -> ApiRequestPlanSummary {
        ApiRequestPlanSummary {
            environment_id: Uuid::new_v4(),
            environment_revision: 1,
            environment_policy_digest: "a".repeat(64),
            request_digest: "b".repeat(64),
            method: method.into(),
            origin: origin.into(),
            base_path: Some("/v1".into()),
            path: "/v1/status".into(),
            body_type: "none".into(),
            query_count: 0,
            request_header_count: 0,
            fixed_header_count: 0,
            auth_type: "none".into(),
            mutation: !matches!(method, "GET" | "HEAD"),
        }
    }

    #[test]
    fn ct_api_request_sec_001_classifies_and_denies_sensitive_targets() {
        assert_eq!(
            classify_target("127.0.0.1".parse().unwrap()).unwrap(),
            ApiTargetClass::Loopback
        );
        assert_eq!(
            classify_target("10.0.0.7".parse().unwrap()).unwrap(),
            ApiTargetClass::Private
        );
        assert_eq!(
            classify_target("8.8.8.8".parse().unwrap()).unwrap(),
            ApiTargetClass::Public
        );
        for denied in [
            "0.0.0.0",
            "169.254.1.1",
            "169.254.169.254",
            "224.0.0.1",
            "::",
            "fe80::1",
            "fd00:ec2::254",
        ] {
            assert!(
                classify_target(denied.parse().unwrap()).is_err(),
                "accepted {denied}"
            );
        }
        assert_eq!(
            resolve_bound_target(&summary("http://8.8.8.8", "GET")).unwrap_err(),
            "api-public-http-denied"
        );
        let local = resolve_bound_target(&summary("http://127.0.0.1:8080", "GET")).unwrap();
        assert!(requires_native_confirmation(
            &summary("http://127.0.0.1:8080", "GET"),
            &local
        ));
    }

    #[test]
    fn ct_api_request_001_store_is_bounded_single_use_and_cancellable() {
        let mut store = DesktopApiRequestStore::default();
        let target = resolve_bound_target(&summary("https://8.8.8.8", "GET")).unwrap();
        let (reference, _) = store
            .insert(
                summary("https://8.8.8.8", "GET"),
                b"{}".to_vec(),
                target,
                10,
            )
            .unwrap();
        let active = store.begin(reference, 11).unwrap();
        assert_eq!(
            store.begin(reference, 12).err(),
            Some("api-request-expired")
        );
        assert!(store.cancel(reference));
        assert!(active.cancellation.load(Ordering::Acquire));
        store.finish(reference);
        assert!(!store.cancel(reference));

        let target = resolve_bound_target(&summary("https://8.8.8.8", "GET")).unwrap();
        let (reference, _) = store
            .insert(
                summary("https://8.8.8.8", "GET"),
                b"{}".to_vec(),
                target,
                20,
            )
            .unwrap();
        let active = store.begin(reference, 21).unwrap();
        store.clear();
        assert!(active.cancellation.load(Ordering::Acquire));
        assert!(!store.cancel(reference));
        assert!(operation_invalidates_api_requests(
            "api-environments.update"
        ));
        assert!(operation_invalidates_api_requests("secrets.delete"));
        assert!(!operation_invalidates_api_requests(
            "api-environments.detail"
        ));
    }

    #[test]
    fn ct_api_request_sec_001_response_canary_and_json_limits_fail_closed() {
        let canaries = vec!["bound-secret-value".to_owned()];
        assert!(contains_secret_representation(
            b"bound-secret-value",
            &canaries
        ));
        assert!(contains_secret_representation(
            STANDARD.encode("bound-secret-value").as_bytes(),
            &canaries
        ));
        assert!(!contains_secret_representation(
            b"ordinary response",
            &canaries
        ));
        let mut nested = Value::Null;
        for _ in 0..=MAX_RESPONSE_JSON_DEPTH + 1 {
            nested = json!({ "next": nested });
        }
        let mut items = 0;
        assert_eq!(
            validate_response_json(&nested, 0, &mut items)
                .unwrap_err()
                .code,
            "response-json-too-deep"
        );
    }

    #[test]
    fn ct_api_request_001_executor_sends_bearer_and_reconstructs_json() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 4096];
            let length = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..length]);
            assert!(request.starts_with("GET /v1/status?trace=42 HTTP/1.1"));
            assert!(
                request
                    .to_ascii_lowercase()
                    .contains("authorization: bearer request-token-canary")
            );
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\nSet-Cookie: forbidden=1\r\n\r\n{\"ok\":true}").unwrap();
        });
        let mut request_summary = summary(&format!("http://127.0.0.1:{}", address.port()), "GET");
        request_summary.query_count = 1;
        let target = resolve_bound_target(&request_summary).unwrap();
        let plan = ApiRequestExecutionPlan {
            summary: request_summary,
            query: vec![ApiRequestValueMaterial {
                name: "trace".into(),
                value: Zeroizing::new("42".into()),
            }],
            headers: Vec::new(),
            body: ApiRequestBodyInput::None,
            authentication: ApiRequestAuthenticationMaterial::Bearer {
                token: Zeroizing::new("request-token-canary".into()),
            },
            canaries: Zeroizing::new(vec!["request-token-canary".into()]),
        };
        let response = execute_api_request(plan, target, &AtomicBool::new(false)).unwrap();
        assert_eq!(response["status"], 200);
        assert_eq!(response["body"]["type"], "json");
        assert_eq!(response["body"]["value"]["ok"], true);
        assert!(
            !serde_json::to_string(&response)
                .unwrap()
                .contains("set-cookie")
        );
        server.join().unwrap();
    }

    #[test]
    fn ct_api_request_001_executor_injects_basic_and_api_key_without_renderer_secrets() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };
        let run = |method: &str,
                   authentication: ApiRequestAuthenticationMaterial,
                   expected: &'static str| {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0_u8; 4096];
                let length = stream.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..length]);
                assert!(request.to_ascii_lowercase().contains(expected));
                stream
                    .write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n")
                    .unwrap();
            });
            let mut request_summary =
                summary(&format!("http://127.0.0.1:{}", address.port()), method);
            request_summary.body_type = if method == "POST" {
                "text".into()
            } else {
                "none".into()
            };
            let target = resolve_bound_target(&request_summary).unwrap();
            let plan = ApiRequestExecutionPlan {
                summary: request_summary,
                query: Vec::new(),
                headers: Vec::new(),
                body: if method == "POST" {
                    ApiRequestBodyInput::Text {
                        value: "hello".into(),
                    }
                } else {
                    ApiRequestBodyInput::None
                },
                authentication,
                canaries: Zeroizing::new(vec!["basic-password".into(), "api-key-value".into()]),
            };
            assert_eq!(
                execute_api_request(plan, target, &AtomicBool::new(false)).unwrap()["status"],
                204
            );
            server.join().unwrap();
        };
        run(
            "POST",
            ApiRequestAuthenticationMaterial::Basic {
                username: Zeroizing::new("ada".into()),
                password: Zeroizing::new("basic-password".into()),
            },
            "authorization: basic ywrhomjhc2ljlxbhc3n3b3jk",
        );
        run(
            "GET",
            ApiRequestAuthenticationMaterial::ApiKey {
                location: ApiKeyLocation::Query,
                name: "api_key".into(),
                value: Zeroizing::new("api-key-value".into()),
            },
            "get /v1/status?api_key=api-key-value http/1.1",
        );
    }

    #[test]
    fn ct_api_request_sec_001_denies_self_signed_tls_and_secret_reflection() {
        use std::{
            io::{Read, Write},
            net::{Ipv4Addr, TcpListener},
        };
        let rcgen::CertifiedKey { cert, signing_key } =
            rcgen::generate_simple_self_signed(vec!["127.0.0.1".into()]).unwrap();
        let server_config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(
                vec![rustls::pki_types::CertificateDer::from(cert.der().to_vec())],
                rustls::pki_types::PrivateKeyDer::Pkcs8(
                    rustls::pki_types::PrivatePkcs8KeyDer::from(signing_key.serialize_der()),
                ),
            )
            .unwrap();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let connection = rustls::ServerConnection::new(Arc::new(server_config)).unwrap();
            let mut tls = rustls::StreamOwned::new(connection, stream);
            let mut buffer = [0_u8; 256];
            let _ = tls.read(&mut buffer);
        });
        let request_summary = summary(&format!("https://127.0.0.1:{port}"), "GET");
        let target = resolve_bound_target(&request_summary).unwrap();
        let plan = ApiRequestExecutionPlan {
            summary: request_summary,
            query: Vec::new(),
            headers: Vec::new(),
            body: ApiRequestBodyInput::None,
            authentication: ApiRequestAuthenticationMaterial::None,
            canaries: Zeroizing::new(Vec::new()),
        };
        assert_eq!(
            execute_api_request(plan, target, &AtomicBool::new(false))
                .unwrap_err()
                .code,
            "connect-failed"
        );
        server.join().unwrap();

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let reflection = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 16\r\n\r\nreflected-secret").unwrap();
        });
        let request_summary = summary(&format!("http://127.0.0.1:{}", address.port()), "GET");
        let target = resolve_bound_target(&request_summary).unwrap();
        let plan = ApiRequestExecutionPlan {
            summary: request_summary,
            query: Vec::new(),
            headers: Vec::new(),
            body: ApiRequestBodyInput::None,
            authentication: ApiRequestAuthenticationMaterial::Bearer {
                token: Zeroizing::new("reflected-secret".into()),
            },
            canaries: Zeroizing::new(vec!["reflected-secret".into()]),
        };
        assert_eq!(
            execute_api_request(plan, target, &AtomicBool::new(false))
                .unwrap_err()
                .code,
            "secret-detected"
        );
        reflection.join().unwrap();
    }

    #[test]
    fn ct_api_request_sec_001_denies_redirects_and_compressed_responses() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };

        let run = |response: &'static [u8], expected_code: &'static str| {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0_u8; 1024];
                let _ = stream.read(&mut request);
                stream.write_all(response).unwrap();
            });
            let request_summary = summary(&format!("http://127.0.0.1:{}", address.port()), "GET");
            let target = resolve_bound_target(&request_summary).unwrap();
            let plan = ApiRequestExecutionPlan {
                summary: request_summary,
                query: Vec::new(),
                headers: Vec::new(),
                body: ApiRequestBodyInput::None,
                authentication: ApiRequestAuthenticationMaterial::None,
                canaries: Zeroizing::new(Vec::new()),
            };
            assert_eq!(
                execute_api_request(plan, target, &AtomicBool::new(false))
                    .unwrap_err()
                    .code,
                expected_code
            );
            server.join().unwrap();
        };

        run(
            b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/other\r\nContent-Length: 0\r\n\r\n",
            "redirect-denied",
        );
        run(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Encoding: gzip\r\nContent-Length: 4\r\n\r\ntest",
            "compressed-response-denied",
        );
    }

    #[test]
    fn ct_api_request_001_mutation_cancel_after_send_is_execution_unknown() {
        use std::{io::Read, net::TcpListener, sync::mpsc::channel, time::Instant};

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (received_sender, received_receiver) = channel();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            received_sender.send(()).unwrap();
            std::thread::sleep(Duration::from_millis(250));
        });
        let request_summary = summary(&format!("http://127.0.0.1:{}", address.port()), "POST");
        let target = resolve_bound_target(&request_summary).unwrap();
        let plan = ApiRequestExecutionPlan {
            summary: request_summary,
            query: Vec::new(),
            headers: Vec::new(),
            body: ApiRequestBodyInput::Text {
                value: "mutation".into(),
            },
            authentication: ApiRequestAuthenticationMaterial::None,
            canaries: Zeroizing::new(Vec::new()),
        };
        let cancellation = Arc::new(AtomicBool::new(false));
        let worker_cancellation = Arc::clone(&cancellation);
        let worker = std::thread::spawn(move || {
            execute_api_request(plan, target, worker_cancellation.as_ref())
        });
        received_receiver
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        cancellation.store(true, Ordering::Release);
        let started = Instant::now();
        let error = worker.join().unwrap().unwrap_err();
        assert_eq!(error.state, "execution-unknown");
        assert_eq!(error.code, "request-cancelled");
        assert!(started.elapsed() < Duration::from_secs(1));
        server.join().unwrap();
    }
}
