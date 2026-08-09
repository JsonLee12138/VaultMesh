use std::collections::{HashMap, HashSet};

use chrono::DateTime;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use url::Url;
use uuid::Uuid;
use vaultmesh_ffi::{
    DesktopRuntime, DesktopRuntimeError, VAULTMESH_ITEM_KIND_LOGIN,
    VAULTMESH_ITEM_KIND_PAYMENT_CARD, VAULTMESH_ITEM_KIND_SECRET,
    VAULTMESH_ITEM_KIND_SSH_CREDENTIAL, VAULTMESH_PROTECTED_FIELD_CARD_NUMBER,
    VAULTMESH_PROTECTED_FIELD_CARD_SECURITY_CODE, VAULTMESH_PROTECTED_FIELD_LOGIN_PASSWORD,
    VAULTMESH_PROTECTED_FIELD_SECRET_VALUE, VAULTMESH_PROTECTED_FIELD_SSH_KEY_PASSPHRASE,
    VAULTMESH_PROTECTED_FIELD_SSH_PASSWORD, VAULTMESH_PROTECTED_FIELD_SSH_PRIVATE_KEY,
    VAULTMESH_PROTECTED_FIELD_SSH_PUBLIC_KEY, VAULTMESH_STATUS_AUTH_FAILED,
    VAULTMESH_STATUS_INVALID_ARGUMENT, VAULTMESH_STATUS_LOCKED, VAULTMESH_STATUS_REAUTH_REQUIRED,
};

use crate::browser_broker::BrowserPlatformError;

const MAX_DISCOVERY_LIFETIME_MILLIS: i64 = 70_000;

#[derive(Default)]
pub struct BrowserFillService {
    seen_discoveries: HashMap<Uuid, i64>,
}

#[derive(Clone)]
pub struct FillPrompt {
    pub item_title: String,
    pub item_kind: String,
    pub origin: String,
}

impl BrowserFillService {
    pub fn clear(&mut self) {
        self.seen_discoveries.clear();
    }

    pub fn candidates(
        &self,
        runtime: &mut DesktopRuntime,
        input: &Map<String, Value>,
    ) -> Result<Value, BrowserPlatformError> {
        let input: CandidateInput = serde_json::from_value(Value::Object(input.clone()))
            .map_err(|_| invalid("自动填充候选查询无效。"))?;
        let top_origin = http_origin(&input.top_origin)?;
        let page_url = input.page_url.unwrap_or_else(|| input.top_origin.clone());
        let page = http_page(&page_url)?;
        if page.origin().ascii_serialization() != top_origin {
            return Err(invalid("页面 URL 与顶层来源不匹配。"));
        }
        if !matches!(
            input.field_kind.as_str(),
            "login" | "card" | "identity" | "secret" | "ssh"
        ) || !valid_context(&input.page_context)
        {
            return Err(invalid("自动填充候选查询无效。"));
        }

        let summaries = match input.field_kind.as_str() {
            "login" => runtime.browser_login_metadata(),
            "card" => runtime.execute("cards.list", json!({})),
            "identity" => runtime.execute("identities.list", json!({})),
            "secret" => runtime.execute("secrets.list", json!({})),
            "ssh" => runtime.execute("ssh.list", json!({})),
            _ => unreachable!(),
        }
        .map_err(runtime_error)?;
        let mut candidates = Vec::new();
        for summary in summaries
            .as_array()
            .ok_or_else(|| failure("候选列表无效。"))?
        {
            if candidates.len() == 200 {
                break;
            }
            let id = value_string(summary, "id")?;
            let title = value_string(summary, "title")?;
            let candidate = match input.field_kind.as_str() {
                "login" => {
                    if input.page_context == "otp"
                        && !summary
                            .get("hasTotpSecret")
                            .and_then(Value::as_bool)
                            .unwrap_or(false)
                    {
                        continue;
                    }
                    let Some(scope) = login_match_scope(&page, summary) else {
                        continue;
                    };
                    json!({
                        "id": id, "kind": "login", "title": title,
                        "subtitle": summary.get("username").and_then(Value::as_str).unwrap_or(""),
                        "matchScope": scope,
                        "autofillOnPageLoad": summary.get("autofillOnPageLoad").and_then(Value::as_bool).unwrap_or(false),
                        "masterPasswordReprompt": summary.get("masterPasswordReprompt").and_then(Value::as_bool).unwrap_or(false),
                    })
                }
                "card" => json!({
                    "id": id, "kind": "card", "title": title,
                    "subtitle": summary.get("maskedNumber").and_then(Value::as_str).unwrap_or(""),
                    "masterPasswordReprompt": summary.get("masterPasswordReprompt").and_then(Value::as_bool).unwrap_or(false),
                }),
                "identity" => json!({
                    "id": id, "kind": "identity", "title": title,
                    "subtitle": summary.get("displayName").and_then(Value::as_str)
                        .or_else(|| summary.get("organization").and_then(Value::as_str)).unwrap_or(""),
                }),
                "secret" => {
                    if input.page_context != "developer-secret"
                        && !summary
                            .get("website")
                            .and_then(Value::as_str)
                            .is_some_and(|website| site_matches(&page, website))
                    {
                        continue;
                    }
                    let subtitle = ["provider", "account", "environment"]
                        .into_iter()
                        .filter_map(|key| summary.get(key).and_then(Value::as_str))
                        .filter(|value| !value.is_empty())
                        .collect::<Vec<_>>()
                        .join(" · ");
                    json!({
                        "id": id, "kind": "secret", "title": title, "subtitle": subtitle,
                        "masterPasswordReprompt": summary.get("masterPasswordReprompt").and_then(Value::as_bool).unwrap_or(false),
                    })
                }
                "ssh" => {
                    if input.page_context != "ssh-console"
                        && !summary
                            .get("host")
                            .and_then(Value::as_str)
                            .is_some_and(|host| {
                                page.host_str().is_some_and(|page_host| {
                                    page_host.eq_ignore_ascii_case(host.trim())
                                })
                            })
                    {
                        continue;
                    }
                    let username = summary
                        .get("username")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let subtitle = summary
                        .get("host")
                        .and_then(Value::as_str)
                        .map(|host| format!("{username}@{host}"))
                        .unwrap_or_else(|| username.to_owned());
                    json!({
                        "id": id, "kind": "ssh", "title": title, "subtitle": subtitle,
                        "masterPasswordReprompt": summary.get("masterPasswordReprompt").and_then(Value::as_bool).unwrap_or(false),
                    })
                }
                _ => unreachable!(),
            };
            candidates.push(candidate);
        }
        Ok(json!({ "candidates": candidates }))
    }

    pub fn prompt(
        &self,
        input: &Map<String, Value>,
        now_millis: i64,
    ) -> Result<FillPrompt, BrowserPlatformError> {
        let request = parse_execute(input, now_millis)?;
        let selected = request
            .discovery
            .selected_item
            .ok_or_else(|| confirmation("请先在插件中选择要填充的项目。"))?;
        Ok(FillPrompt {
            item_title: selected.title,
            item_kind: selected.kind,
            origin: request.discovery.target_origin,
        })
    }

    pub fn execute(
        &mut self,
        runtime: &mut DesktopRuntime,
        input: &Map<String, Value>,
        now_millis: i64,
    ) -> Result<Value, BrowserPlatformError> {
        let request = parse_execute(input, now_millis)?;
        let discovery = request.discovery;
        self.seen_discoveries
            .retain(|_, expiry| *expiry > now_millis);
        if self.seen_discoveries.contains_key(&discovery.request_id) {
            return Err(invalid("自动填充页面字段描述不能重复使用。"));
        }
        self.seen_discoveries
            .insert(discovery.request_id, discovery.expires_millis);

        let selected = discovery
            .selected_item
            .clone()
            .ok_or_else(|| invalid("自动填充请求没有所选项目。"))?;
        if request.mode != "selection" && request.mode != "automatic" {
            return Err(invalid("自动填充模式无效。"));
        }
        if request.mode == "automatic" && selected.kind != "login" {
            return Err(confirmation("自动填充只允许匹配的登录项目。"));
        }

        let detail_operation = match selected.kind.as_str() {
            "login" => "items.detail",
            "card" => "cards.detail",
            "identity" => "identities.detail",
            "secret" => "secrets.detail",
            "ssh" => "ssh.detail",
            _ => return Err(invalid("所选项目类型无效。")),
        };
        let detail = runtime
            .execute(detail_operation, json!({ "id": selected.id }))
            .map_err(|_| confirmation("无法确认所选填充项目。"))?;
        if request.mode == "automatic" {
            let page = http_page(&discovery.target_page_url)?;
            if !detail
                .get("autofillOnPageLoad")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || login_match_scope(&page, &detail).is_none()
            {
                return Err(confirmation("该登录项目不能自动填充此页面。"));
            }
        }

        if selected.kind == "card" {
            let password = request
                .master_password
                .as_deref()
                .ok_or_else(|| reprompt("请在插件中输入主密码确认填充。"))?;
            runtime
                .verify_master_password(password)
                .map_err(|_| failure("主密码不正确，无法完成填充。"))?;
        }

        let values = fill_values(
            runtime,
            &selected.kind,
            &detail,
            request.master_password.as_deref(),
        )?;
        let actual_title = detail
            .get("title")
            .and_then(Value::as_str)
            .ok_or_else(|| failure("所选项目无效。"))?;
        let mut frames = Vec::new();
        for frame in &discovery.frames {
            let mut assignments = Vec::new();
            for field in &frame.fields {
                let Some(value) = map_field(&selected.kind, &values, field) else {
                    continue;
                };
                if value.is_empty() || value.chars().count() > 10_000 {
                    continue;
                }
                assignments.push(json!({
                    "handle": field.handle,
                    "value": value,
                    "overwrite": request.mode == "selection" && selected.kind == "login" && !field.is_empty,
                }));
            }
            if !assignments.is_empty() {
                frames.push(json!({
                    "frameId": frame.frame_id,
                    "documentId": frame.document_id,
                    "frameOrigin": frame.frame_origin,
                    "assignments": assignments,
                }));
            }
        }
        if frames.is_empty() {
            return Err(invalid("页面中没有可安全自动填充的字段。"));
        }
        Ok(json!({
            "kind": "vaultmesh.approved-fill",
            "requestId": discovery.request_id,
            "tabId": discovery.tab_id,
            "topOrigin": discovery.top_origin,
            "expiresAt": discovery.expires_at,
            "selectedItem": { "kind": selected.kind, "id": selected.id, "title": actual_title },
            "frames": frames,
        }))
    }
}

pub fn email_otp_assignment(
    seen_discoveries: &mut HashMap<Uuid, i64>,
    input: &Map<String, Value>,
    code: &str,
    now_millis: i64,
) -> Result<Value, BrowserPlatformError> {
    if !(4..=8).contains(&code.len())
        || !code.bytes().all(|value| value.is_ascii_alphanumeric())
        || !code.bytes().any(|value| value.is_ascii_digit())
    {
        return Err(invalid("邮箱验证码候选无效。"));
    }
    input
        .get("candidateId")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| invalid("邮箱验证码候选无效。"))?;
    let mut execute = input.clone();
    execute.remove("candidateId");
    execute.insert("mode".into(), Value::String("selection".into()));
    let request = parse_execute(&execute, now_millis)?;
    let discovery = request.discovery;
    if discovery.selected_item.is_some() {
        return Err(invalid("邮箱验证码填充不能携带 Vault 项目。"));
    }
    if discovery.top_origin != discovery.target_origin {
        return Err(invalid("邮箱验证码只允许填入当前顶层来源。"));
    }
    seen_discoveries.retain(|_, expiry| *expiry > now_millis);
    if seen_discoveries.contains_key(&discovery.request_id) {
        return Err(invalid("邮箱验证码页面字段描述不能重复使用。"));
    }
    seen_discoveries.insert(discovery.request_id, discovery.expires_millis);

    let code_characters = code
        .chars()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    let mut frames = Vec::new();
    for frame in &discovery.frames {
        let fields = frame
            .fields
            .iter()
            .filter(|field| field.is_empty && email_otp_field(field, code))
            .collect::<Vec<_>>();
        if fields.is_empty() {
            continue;
        }
        let segmented = fields.len() == code_characters.len()
            && fields.len() >= 2
            && fields.iter().all(|field| field.max_length == Some(1));
        let assignments = fields
            .iter()
            .enumerate()
            .filter_map(|(index, field)| {
                let value = if segmented {
                    code_characters.get(index)?.clone()
                } else {
                    code.to_owned()
                };
                Some(json!({
                    "handle": field.handle,
                    "value": value,
                    "overwrite": false,
                }))
            })
            .collect::<Vec<_>>();
        if !assignments.is_empty() {
            frames.push(json!({
                "frameId": frame.frame_id,
                "documentId": frame.document_id,
                "frameOrigin": frame.frame_origin,
                "assignments": assignments,
            }));
        }
    }
    if frames.is_empty() {
        return Err(invalid("页面中没有可安全填入邮箱验证码的空字段。"));
    }
    Ok(json!({
        "kind": "vaultmesh.approved-fill",
        "requestId": discovery.request_id,
        "tabId": discovery.tab_id,
        "topOrigin": discovery.top_origin,
        "expiresAt": discovery.expires_at,
        "frames": frames,
    }))
}

fn email_otp_field(field: &DiscoveredField, code: &str) -> bool {
    if field.control != "input"
        || field
            .max_length
            .is_some_and(|maximum| code.chars().count() > maximum as usize && maximum != 1)
    {
        return false;
    }
    let input_type = field
        .input_type
        .as_deref()
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(input_type.as_str(), "" | "text" | "tel" | "number")
        || input_type == "number" && !code.bytes().all(|value| value.is_ascii_digit())
    {
        return false;
    }
    let metadata = normalize(&format!(
        "{} {} {} {} {}",
        field.label,
        field.name,
        field.id,
        field.placeholder,
        field.autocomplete.join(" ")
    ));
    field.context == "otp"
        || field
            .autocomplete
            .iter()
            .any(|value| value == "one-time-code")
        || contains_any(
            &metadata,
            &[
                "otp",
                "2fa",
                "mfa",
                "onetimecode",
                "verificationcode",
                "securitycode",
                "验证码",
                "校验码",
                "动态码",
            ],
        )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CandidateInput {
    top_origin: String,
    page_url: Option<String>,
    #[serde(default = "login_kind")]
    field_kind: String,
    #[serde(default = "unknown_context")]
    page_context: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExecuteInput {
    discovery: Discovery,
    #[serde(default = "automatic_mode")]
    mode: String,
    master_password: Option<String>,
    #[serde(default, rename = "userGestureId")]
    _user_gesture_id: Option<Uuid>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Discovery {
    version: u32,
    request_id: Uuid,
    issued_at: String,
    expires_at: String,
    tab_id: u64,
    top_origin: String,
    target_origin: String,
    target_page_url: String,
    selected_item: Option<SelectedItem>,
    frames: Vec<DiscoveryFrame>,
    #[serde(skip)]
    expires_millis: i64,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelectedItem {
    kind: String,
    id: Uuid,
    title: String,
    #[serde(default, rename = "masterPasswordReprompt")]
    _master_password_reprompt: Option<bool>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiscoveryFrame {
    frame_id: u64,
    document_id: Uuid,
    frame_origin: String,
    fields: Vec<DiscoveredField>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiscoveredField {
    handle: Uuid,
    control: String,
    input_type: Option<String>,
    max_length: Option<u8>,
    is_empty: bool,
    autocomplete: Vec<String>,
    label: String,
    name: String,
    id: String,
    placeholder: String,
    #[serde(default = "unknown_context")]
    context: String,
    options: Option<Vec<SelectOption>>,
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct SelectOption {
    value: String,
    text: String,
}

#[derive(Default)]
struct FillValues {
    values: HashMap<String, String>,
    custom_fields: Vec<(String, String)>,
    secret_kind: Option<String>,
}

fn parse_execute(
    input: &Map<String, Value>,
    now_millis: i64,
) -> Result<ExecuteInput, BrowserPlatformError> {
    let mut request: ExecuteInput = serde_json::from_value(Value::Object(input.clone()))
        .map_err(|_| invalid("自动填充页面字段描述无效。"))?;
    let discovery = &mut request.discovery;
    let issued = DateTime::parse_from_rfc3339(&discovery.issued_at)
        .map_err(|_| invalid("自动填充页面字段描述无效。"))?
        .timestamp_millis();
    let expires = DateTime::parse_from_rfc3339(&discovery.expires_at)
        .map_err(|_| invalid("自动填充页面字段描述无效。"))?
        .timestamp_millis();
    discovery.expires_millis = expires;
    if discovery.version != 1
        || expires <= now_millis
        || expires.saturating_sub(issued) > MAX_DISCOVERY_LIFETIME_MILLIS
        || discovery.frames.is_empty()
        || discovery.frames.len() > 16
        || discovery.selected_item.as_ref().is_some_and(|item| {
            item.title.chars().count() > 256
                || !matches!(
                    item.kind.as_str(),
                    "login" | "card" | "identity" | "secret" | "ssh"
                )
        })
    {
        return Err(invalid("自动填充页面字段描述无效或已过期。"));
    }
    let top = http_origin(&discovery.top_origin)?;
    let target = http_origin(&discovery.target_origin)?;
    let page = http_page(&discovery.target_page_url)?;
    if page.origin().ascii_serialization() != target || top != discovery.top_origin {
        return Err(invalid("自动填充来源绑定无效。"));
    }
    let mut handles = HashSet::new();
    let mut documents = HashSet::new();
    let mut field_count = 0usize;
    for frame in &discovery.frames {
        if frame.frame_origin != discovery.target_origin
            || frame.fields.is_empty()
            || frame.fields.len() > 300
            || !documents.insert((frame.frame_id, frame.document_id))
        {
            return Err(invalid("自动填充 frame 绑定无效。"));
        }
        field_count += frame.fields.len();
        for field in &frame.fields {
            if !handles.insert(field.handle) || !valid_field(field) {
                return Err(invalid("自动填充字段描述无效。"));
            }
        }
    }
    if field_count > 1_600
        || request
            .master_password
            .as_ref()
            .is_some_and(|value| !(8..=1_024).contains(&value.len()))
    {
        return Err(invalid("自动填充页面字段描述无效。"));
    }
    Ok(request)
}

fn valid_field(field: &DiscoveredField) -> bool {
    matches!(
        field.control.as_str(),
        "input" | "textarea" | "select" | "contenteditable"
    ) && field
        .input_type
        .as_ref()
        .is_none_or(|value| text_within(value, 32))
        && field
            .max_length
            .is_none_or(|value| (1..=100).contains(&value))
        && field.autocomplete.len() <= 8
        && field
            .autocomplete
            .iter()
            .all(|value| text_within(value, 64))
        && text_within(&field.label, 240)
        && text_within(&field.name, 160)
        && text_within(&field.id, 160)
        && text_within(&field.placeholder, 160)
        && valid_context(&field.context)
        && field.options.as_ref().is_none_or(|options| {
            options.len() <= 200
                && options
                    .iter()
                    .all(|option| text_within(&option.value, 160) && text_within(&option.text, 160))
        })
}
