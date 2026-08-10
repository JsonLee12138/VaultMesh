use std::{
    collections::{HashMap, HashSet},
    io::Write,
    net::{IpAddr, TcpListener},
    path::{Path, PathBuf},
    sync::OnceLock,
    time::{Duration, Instant},
};

use base64::{
    Engine as _,
    engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD},
};
use chrono::DateTime;
use mailparse::{DispositionType, MailHeaderMap};
use rand_core::{OsRng, RngCore};
use regex::Regex;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;
use vaultmesh_ffi::DesktopRuntime;
use zeroize::{Zeroize, Zeroizing};

const MAX_MESSAGES_PER_SCAN: usize = 30;
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
const MAX_TEXT_BYTES: usize = 512 * 1024;
const MAX_CANDIDATES: usize = 100;
const OAUTH_CALLBACK_TIMEOUT: Duration = Duration::from_secs(180);
const BROWSER_BOOST_SECONDS: u64 = 90;
const BROWSER_BOOST_POLL_SECONDS: u64 = 3;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmailOtpSettings {
    pub enabled: bool,
    pub poll_interval_seconds: u64,
    pub message_lookback_minutes: u64,
    pub code_lifetime_seconds: u64,
    pub require_domain_match: bool,
    pub only_unread_messages: bool,
}

impl Default for EmailOtpSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            poll_interval_seconds: 10,
            message_lookback_minutes: 5,
            code_lifetime_seconds: 90,
            require_domain_match: false,
            only_unread_messages: true,
        }
    }
}

impl EmailOtpSettings {
    fn validate(&self) -> bool {
        (5..=300).contains(&self.poll_interval_seconds)
            && (1..=30).contains(&self.message_lookback_minutes)
            && (30..=300).contains(&self.code_lifetime_seconds)
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmailAccount {
    id: Uuid,
    label: String,
    address: String,
    provider: String,
    auth_kind: String,
    credential: String,
    imap_host: String,
    imap_port: u16,
    use_tls: bool,
    enabled: bool,
}

impl Drop for EmailAccount {
    fn drop(&mut self) {
        self.credential.zeroize();
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountStatus {
    status: &'static str,
    status_message: Option<String>,
    last_tested_at: Option<u64>,
}

impl Default for AccountStatus {
    fn default() -> Self {
        Self {
            status: "untested",
            status_message: None,
            last_tested_at: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Candidate {
    id: Uuid,
    account_id: Uuid,
    account_address: String,
    code: String,
    sender: String,
    subject: String,
    received_at: u64,
    #[serde(skip)]
    message_id: String,
    expires_at: u64,
}

impl Drop for Candidate {
    fn drop(&mut self) {
        self.account_address.zeroize();
        self.code.zeroize();
        self.sender.zeroize();
        self.subject.zeroize();
        self.message_id.zeroize();
    }
}

#[derive(Clone, Debug)]
struct Message {
    id: String,
    sender: String,
    subject: String,
    text: String,
    received_at: u64,
}

pub(crate) struct EmailScanPlan {
    settings: EmailOtpSettings,
    accounts: Vec<EmailAccount>,
    now: u64,
}

pub(crate) struct EmailScanExecution {
    results: Vec<EmailAccountScanResult>,
    now: u64,
}

struct EmailAccountScanResult {
    account: EmailAccount,
    outcome: Result<EmailAccountScanOutput, String>,
}

struct EmailAccountScanOutput {
    messages: Vec<Message>,
    refreshed_credential: Option<Zeroizing<String>>,
}

impl Drop for Message {
    fn drop(&mut self) {
        self.id.zeroize();
        self.sender.zeroize();
        self.subject.zeroize();
        self.text.zeroize();
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OAuthCredential {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: u64,
    token_type: String,
}

impl Drop for OAuthCredential {
    fn drop(&mut self) {
        self.access_token.zeroize();
        if let Some(value) = &mut self.refresh_token {
            value.zeroize();
        }
    }
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    scope: String,
    #[serde(default = "default_expires_in")]
    expires_in: u64,
    #[serde(default = "default_token_type")]
    token_type: String,
}

impl Drop for TokenResponse {
    fn drop(&mut self) {
        self.access_token.zeroize();
        if let Some(value) = &mut self.refresh_token {
            value.zeroize();
        }
        self.scope.zeroize();
    }
}

fn default_expires_in() -> u64 {
    3600
}

fn default_token_type() -> String {
    "Bearer".to_owned()
}

pub struct EmailOtpService {
    settings: EmailOtpSettings,
    settings_path: PathBuf,
    statuses: HashMap<Uuid, AccountStatus>,
    seen: HashMap<Uuid, HashSet<String>>,
    candidates: Vec<Candidate>,
    last_poll_at: u64,
    browser_boosts: HashMap<String, u64>,
    scan_in_progress: bool,
    pending_execution: Option<EmailScanExecution>,
}

impl EmailOtpService {
    pub fn new(settings_path: PathBuf) -> Self {
        let mut settings = load_settings(&settings_path);
        // Kept in the serialized settings schema for backward compatibility.
        // Browser Email OTP candidates are intentionally global after explicit
        // extension unlock and candidate UI disclosure.
        settings.require_domain_match = false;
        Self {
            settings,
            settings_path,
            statuses: HashMap::new(),
            seen: HashMap::new(),
            candidates: Vec::new(),
            last_poll_at: 0,
            browser_boosts: HashMap::new(),
            scan_in_progress: false,
            pending_execution: None,
        }
    }

    pub fn oauth_availability() -> Value {
        json!({
            "gmail": configured_env("VAULTMESH_GOOGLE_OAUTH_CLIENT_ID"),
            "outlook": configured_env("VAULTMESH_MICROSOFT_OAUTH_CLIENT_ID"),
        })
    }

    pub fn accounts(&self, runtime: &mut DesktopRuntime) -> Result<Value, String> {
        let mut accounts = runtime_value(runtime, "_native.email.accounts", json!({}))?;
        let values = accounts
            .as_array_mut()
            .ok_or_else(|| "邮箱账户数据无效。".to_owned())?;
        for value in values {
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok());
            let status = id
                .and_then(|id| self.statuses.get(&id))
                .cloned()
                .unwrap_or_default();
            let object = value
                .as_object_mut()
                .ok_or_else(|| "邮箱账户数据无效。".to_owned())?;
            object.insert("status".into(), json!(status.status));
            object.insert("statusMessage".into(), json!(status.status_message));
            object.insert("lastTestedAt".into(), json!(status.last_tested_at));
        }
        Ok(accounts)
    }

    pub fn add_account(
        &mut self,
        runtime: &mut DesktopRuntime,
        input: Value,
    ) -> Result<Value, String> {
        validate_transport_policy(&input)?;
        if input.get("authKind").and_then(Value::as_str) == Some("oauth") {
            return Err("Gmail 和 Outlook 必须通过系统浏览器完成 OAuth 授权。".to_owned());
        }
        let summary = runtime_value(runtime, "_native.email.add", input)?;
        self.with_status(summary)
    }

    pub fn update_account(
        &mut self,
        runtime: &mut DesktopRuntime,
        input: Value,
    ) -> Result<Value, String> {
        validate_transport_policy(&input)?;
        let id = uuid_field(&input, "id")?;
        let current = runtime_value(runtime, "_native.email.account", json!({ "id": id }))?;
        let credential_unchanged = input.get("credential").is_none_or(Value::is_null);
        let provider_changed = current.get("provider") != input.get("provider");
        let auth_changed = current.get("authKind") != input.get("authKind");
        if credential_unchanged && (provider_changed || auth_changed) {
            return Err("切换邮箱 Provider 或授权方式时必须重新提供授权信息。".to_owned());
        }
        if input.get("authKind").and_then(Value::as_str) == Some("oauth")
            && (provider_changed || auth_changed)
        {
            return Err("切换到 OAuth Provider 时请删除账户后重新授权。".to_owned());
        }
        let summary = runtime_value(runtime, "_native.email.update", input)?;
        self.statuses.remove(&id);
        self.seen.remove(&id);
        self.candidates
            .retain(|candidate| candidate.account_id != id);
        self.with_status(summary)
    }

    pub fn delete_account(
        &mut self,
        runtime: &mut DesktopRuntime,
        input: Value,
    ) -> Result<Value, String> {
        let id = uuid_field(&input, "id")?;
        let result = runtime_value(runtime, "_native.email.delete", input)?;
        self.statuses.remove(&id);
        self.seen.remove(&id);
        self.candidates
            .retain(|candidate| candidate.account_id != id);
        Ok(result)
    }

    pub fn settings(&self) -> Value {
        json!(self.settings)
    }

    pub fn update_settings(&mut self, input: Value) -> Result<Value, String> {
        let mut settings: EmailOtpSettings =
            serde_json::from_value(input).map_err(|_| "邮箱读取设置无效。".to_owned())?;
        settings.require_domain_match = false;
        if !settings.validate() {
            return Err("邮箱读取设置无效。".to_owned());
        }
        persist_settings(&self.settings_path, &settings)?;
        self.settings = settings;
        if !self.settings.enabled {
            self.candidates.clear();
        }
        Ok(json!(self.settings))
    }

    pub(crate) fn begin_scan(
        &mut self,
        runtime: &mut DesktopRuntime,
        now: u64,
    ) -> Result<EmailScanPlan, String> {
        if self.scan_in_progress {
            return Err("邮箱验证码检查正在进行。".to_owned());
        }
        self.last_poll_at = now;
        if !self.settings.enabled {
            return Err("请先启用邮箱验证码读取。".to_owned());
        }
        self.browser_boosts.retain(|_, expiry| *expiry > now);
        self.prune(now);
        let summaries = runtime_value(runtime, "_native.email.accounts", json!({}))?;
        let accounts = summaries
            .as_array()
            .ok_or_else(|| "邮箱账户数据无效。".to_owned())?
            .iter()
            .filter(|value| value.get("enabled").and_then(Value::as_bool) == Some(true))
            .map(|value| {
                let id = value
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "邮箱账户数据无效。".to_owned())?;
                let account = runtime_value(runtime, "_native.email.account", json!({ "id": id }))?;
                serde_json::from_value(account).map_err(|_| "邮箱账户数据无效。".to_owned())
            })
            .collect::<Result<Vec<EmailAccount>, String>>()?;
        self.scan_in_progress = true;
        Ok(EmailScanPlan {
            settings: self.settings.clone(),
            accounts,
            now,
        })
    }

    pub(crate) fn execute_scan(plan: EmailScanPlan) -> EmailScanExecution {
        let results = plan
            .accounts
            .into_iter()
            .map(|account| EmailAccountScanResult {
                outcome: scan_account_network(&account, &plan.settings, plan.now),
                account,
            })
            .collect();
        EmailScanExecution {
            results,
            now: plan.now,
        }
    }

    pub(crate) fn finish_scan(
        &mut self,
        runtime: &mut DesktopRuntime,
        execution: EmailScanExecution,
    ) -> Result<Value, String> {
        self.scan_in_progress = false;
        let mut failures = Vec::new();
        for result in execution.results {
            let Ok(current) = runtime_value(
                runtime,
                "_native.email.account",
                json!({ "id": result.account.id }),
            ) else {
                continue;
            };
            let Ok(current) = serde_json::from_value::<EmailAccount>(current) else {
                continue;
            };
            if current != result.account {
                continue;
            }
            match result.outcome {
                Ok(output) => {
                    if let Some(credential) = output.refreshed_credential
                        && let Err(error) = update_oauth_credential(runtime, &current, &credential)
                    {
                        self.record_scan_error(current.id, &error, execution.now);
                        failures.push(error);
                        continue;
                    }
                    self.ingest(&current, output.messages, execution.now);
                    self.statuses.insert(
                        current.id,
                        AccountStatus {
                            status: "connected",
                            status_message: Some("只读连接成功。".to_owned()),
                            last_tested_at: Some(execution.now),
                        },
                    );
                }
                Err(error) => {
                    self.record_scan_error(current.id, &error, execution.now);
                    failures.push(error);
                }
            }
        }
        if self.candidates.is_empty() && !failures.is_empty() {
            return Err(failures.remove(0));
        }
        self.candidates
            .sort_by_key(|candidate| std::cmp::Reverse(candidate.received_at));
        Ok(json!(self.candidates))
    }

    pub(crate) fn queue_scan_execution(&mut self, execution: EmailScanExecution) {
        if self.scan_in_progress && self.pending_execution.is_none() {
            self.pending_execution = Some(execution);
        }
    }

    pub(crate) fn finish_pending_scan(
        &mut self,
        runtime: &mut DesktopRuntime,
    ) -> Result<Option<Value>, String> {
        let Some(execution) = self.pending_execution.take() else {
            return Ok(None);
        };
        self.finish_scan(runtime, execution).map(Some)
    }

    pub(crate) fn abort_scan(&mut self) {
        self.scan_in_progress = false;
        self.pending_execution = None;
    }

    pub fn test_account(
        &mut self,
        runtime: &mut DesktopRuntime,
        input: Value,
        now: u64,
    ) -> Result<Value, String> {
        let id = uuid_field(&input, "id")?;
        let result = self.scan_account(runtime, &id.to_string(), now);
        let status = match result {
            Ok(()) => AccountStatus {
                status: "connected",
                status_message: Some("只读连接成功。".to_owned()),
                last_tested_at: Some(now),
            },
            Err(error) => AccountStatus {
                status: "error",
                status_message: Some(error),
                last_tested_at: Some(now),
            },
        };
        self.statuses.insert(id, status);
        let account = runtime_value(runtime, "_native.email.account", json!({ "id": id }))?;
        self.summary_from_account(account)
    }

    pub fn prepare_oauth(input: Value, now: u64) -> Result<Value, String> {
        let provider = input
            .get("provider")
            .and_then(Value::as_str)
            .filter(|value| matches!(*value, "gmail" | "outlook"))
            .ok_or_else(|| "OAuth Provider 无效。".to_owned())?;
        let label = input
            .get("label")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty() && value.len() <= 128)
            .ok_or_else(|| "账户名称无效。".to_owned())?;
        let (credential, address) = authorize(provider, now)?;
        let (imap_host, imap_port) = if provider == "gmail" {
            ("gmail.googleapis.com", 443)
        } else {
            ("graph.microsoft.com", 443)
        };
        let credential =
            serde_json::to_string(&credential).map_err(|_| "无法保存 OAuth 授权。".to_owned())?;
        Ok(json!({
            "label": label,
            "address": address,
            "provider": provider,
            "authKind": "oauth",
            "credential": credential,
            "imapHost": imap_host,
            "imapPort": imap_port,
            "useTls": true,
            "enabled": true,
        }))
    }

    pub fn add_authorized_oauth(
        &mut self,
        runtime: &mut DesktopRuntime,
        input: Value,
    ) -> Result<Value, String> {
        let summary = runtime_value(runtime, "_native.email.add", input)?;
        self.with_status(summary)
    }

    pub fn clear_runtime_state(&mut self) {
        self.statuses.clear();
        self.seen.clear();
        self.candidates.clear();
        self.last_poll_at = 0;
        self.browser_boosts.clear();
        self.scan_in_progress = false;
        self.pending_execution = None;
    }

    pub fn poll_due(&self, now: u64) -> bool {
        let interval = if self.browser_boost_active(now) {
            BROWSER_BOOST_POLL_SECONDS
        } else {
            self.settings.poll_interval_seconds
        };
        self.settings.enabled && now.saturating_sub(self.last_poll_at) >= interval
    }

    pub fn start_browser_boost(&mut self, origin: &str, now: u64) -> Result<Value, String> {
        let host = browser_origin_host(origin)?;
        if !self.settings.enabled {
            return Err("请先启用邮箱验证码读取。".to_owned());
        }
        let expires_at = now.saturating_add(BROWSER_BOOST_SECONDS);
        self.browser_boosts.insert(host, expires_at);
        Ok(json!({ "watching": true, "boostExpiresAt": expires_at }))
    }

    pub fn browser_boost_active(&self, now: u64) -> bool {
        self.settings.enabled && self.browser_boosts.values().any(|expiry| *expiry > now)
    }

    pub fn stop_browser_boost(&mut self, origin: Option<&str>) -> Result<(), String> {
        if let Some(origin) = origin {
            self.browser_boosts.remove(&browser_origin_host(origin)?);
        } else {
            self.browser_boosts.clear();
        }
        Ok(())
    }

    pub fn browser_candidates(&mut self, origin: &str, now: u64) -> Result<Value, String> {
        let host = browser_origin_host(origin)?;
        self.prune(now);
        self.browser_boosts.retain(|_, expiry| *expiry > now);
        let candidates = self
            .candidates
            .iter()
            .map(|candidate| {
                let source_domain =
                    sender_domain(&candidate.sender).unwrap_or_else(|| "unknown".to_owned());
                json!({
                    "id": candidate.id,
                    "code": candidate.code,
                    "sourceDomain": source_domain,
                    "receivedAt": candidate.received_at,
                    "expiresAt": candidate.expires_at,
                })
            })
            .take(20)
            .collect::<Vec<_>>();
        Ok(json!({
            "candidates": candidates,
            "boostExpiresAt": self.browser_boosts.get(&host).copied().filter(|expiry| *expiry > now).unwrap_or(0),
        }))
    }

    pub fn browser_candidate_code(
        &mut self,
        id: Uuid,
        origin: &str,
        now: u64,
    ) -> Result<Zeroizing<String>, String> {
        browser_origin_host(origin)?;
        self.prune(now);
        self.candidates
            .iter()
            .find(|candidate| candidate.id == id)
            .map(|candidate| Zeroizing::new(candidate.code.clone()))
            .ok_or_else(|| "邮箱验证码候选不存在或已过期。".to_owned())
    }

    /// Moves one exact account-bound candidate into the Rust Agent adapter.
    /// Removal happens before submission so a cancellation or failed page
    /// cannot replay the same short-lived code through another task.
    pub fn take_agent_candidate_code(
        &mut self,
        account_id: Uuid,
        origin: &str,
        now: u64,
    ) -> Result<Zeroizing<String>, String> {
        browser_origin_host(origin)?;
        self.prune(now);
        let index = self
            .candidates
            .iter()
            .enumerate()
            .filter(|(_, candidate)| candidate.account_id == account_id)
            .max_by_key(|(_, candidate)| candidate.received_at)
            .map(|(index, _)| index)
            .ok_or_else(|| "邮箱验证码候选不存在或已过期。".to_owned())?;
        let candidate = self.candidates.remove(index);
        Ok(Zeroizing::new(candidate.code.clone()))
    }

    fn record_scan_error(&mut self, id: Uuid, error: &str, now: u64) {
        self.statuses.insert(
            id,
            AccountStatus {
                status: "error",
                status_message: Some(error.to_owned()),
                last_tested_at: Some(now),
            },
        );
    }

    fn scan_account(
        &mut self,
        runtime: &mut DesktopRuntime,
        id: &str,
        now: u64,
    ) -> Result<(), String> {
        let value = runtime_value(runtime, "_native.email.account", json!({ "id": id }))?;
        let account: EmailAccount =
            serde_json::from_value(value).map_err(|_| "邮箱账户数据无效。".to_owned())?;
        if !account.enabled {
            return Ok(());
        }
        match scan_account_network(&account, &self.settings, now) {
            Ok(output) => {
                if let Some(credential) = output.refreshed_credential {
                    update_oauth_credential(runtime, &account, &credential)?;
                }
                self.ingest(&account, output.messages, now);
                self.statuses.insert(
                    account.id,
                    AccountStatus {
                        status: "connected",
                        status_message: Some("只读连接成功。".to_owned()),
                        last_tested_at: Some(now),
                    },
                );
                Ok(())
            }
            Err(error) => {
                self.statuses.insert(
                    account.id,
                    AccountStatus {
                        status: "error",
                        status_message: Some(error.clone()),
                        last_tested_at: Some(now),
                    },
                );
                Err(error)
            }
        }
    }

    fn ingest(&mut self, account: &EmailAccount, messages: Vec<Message>, now: u64) {
        let seen = self.seen.entry(account.id).or_default();
        for message in messages {
            if seen.contains(&message.id) {
                continue;
            }
            let codes = extract_codes(&format!("{}\n{}", message.subject, message.text));
            if codes.is_empty() {
                continue;
            }
            seen.insert(message.id.clone());
            for code in codes {
                self.candidates.push(Candidate {
                    id: Uuid::new_v4(),
                    account_id: account.id,
                    account_address: account.address.clone(),
                    code,
                    sender: bounded(&message.sender, 320),
                    subject: bounded(&message.subject, 512),
                    received_at: message.received_at,
                    message_id: message.id.clone(),
                    expires_at: now.saturating_add(self.settings.code_lifetime_seconds),
                });
            }
        }
        if seen.len() > 500 {
            seen.clear();
        }
        self.candidates
            .sort_by_key(|candidate| std::cmp::Reverse(candidate.received_at));
        self.candidates.dedup_by(|a, b| {
            a.account_id == b.account_id && a.message_id == b.message_id && a.code == b.code
        });
        self.candidates.truncate(MAX_CANDIDATES);
    }

    fn prune(&mut self, now: u64) {
        self.candidates
            .retain(|candidate| candidate.expires_at > now);
    }

    fn with_status(&self, mut summary: Value) -> Result<Value, String> {
        let id = summary
            .get("id")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok());
        let status = id
            .and_then(|id| self.statuses.get(&id))
            .cloned()
            .unwrap_or_default();
        let object = summary
            .as_object_mut()
            .ok_or_else(|| "邮箱账户数据无效。".to_owned())?;
        object.insert("status".into(), json!(status.status));
        object.insert("statusMessage".into(), json!(status.status_message));
        object.insert("lastTestedAt".into(), json!(status.last_tested_at));
        Ok(summary)
    }

    fn summary_from_account(&self, mut account: Value) -> Result<Value, String> {
        if let Some(object) = account.as_object_mut() {
            object.remove("credential");
            object.insert("hasCredential".into(), Value::Bool(true));
        }
        self.with_status(account)
    }
}
