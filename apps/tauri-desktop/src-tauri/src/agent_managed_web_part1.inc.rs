use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{RecvTimeoutError, SyncSender, sync_channel},
    },
    time::{Duration, Instant},
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Map, Value, json};
use tauri::{
    AppHandle, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    webview::{DownloadEvent, NewWindowResponse, PageLoadEvent},
};
use url::Url;
use vaultmesh_ffi::{AgentWebFieldSource, AgentWebRecipeKind, AgentWebRecipePolicy};
use zeroize::Zeroizing;

use crate::{agent_broker::AgentExecutionScope, agent_resources::load_selected_file};

const OPERATION_TIMEOUT: Duration = Duration::from_secs(12);
const POLL_INTERVAL: Duration = Duration::from_millis(25);
const SESSION_TTL_MILLIS: u64 = 5 * 60_000;
const PASSKEY_REQUEST_TTL_MILLIS: u64 = 60_000;
const MAX_SESSIONS: usize = 4;

pub(crate) struct AgentManagedWebOpenPlan {
    pub definition_id: String,
    pub origins: Vec<String>,
    pub recipes: Vec<AgentWebRecipePolicy>,
    pub username: Zeroizing<String>,
    pub password: Zeroizing<String>,
    pub max_output_bytes: usize,
    pub allowed_output_fields: Vec<String>,
    pub runtime_root: PathBuf,
}

pub(crate) struct AgentManagedWebDownload {
    pub basename: String,
    pub mime: String,
    pub bytes: Zeroizing<Vec<u8>>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AgentManagedWebProtectedKind {
    Totp,
    EmailOtp,
    RecoveryCode,
}

pub(crate) struct AgentManagedWebPasskeyRequest {
    pub operation: &'static str,
    pub request_json: Zeroizing<String>,
    pub origin: String,
    completion_key: String,
    window: WebviewWindow,
    terminal: bool,
}

impl AgentManagedWebPasskeyRequest {
    pub(crate) fn complete(mut self, response_json: &str) -> Result<(), &'static str> {
        let script = passkey_completion_script(&self.completion_key, response_json)?;
        self.window
            .eval(script.as_str())
            .map_err(|_| "passkey-page-completion-failed")?;
        self.terminal = true;
        Ok(())
    }
}

impl Drop for AgentManagedWebPasskeyRequest {
    fn drop(&mut self) {
        if !self.terminal {
            let _ = self
                .window
                .eval(passkey_rejection_script(&self.completion_key));
        }
    }
}

#[derive(Default)]
pub(crate) struct AgentManagedWebStore {
    sessions: HashMap<String, ManagedWebSession>,
}

struct ManagedWebSession {
    client_id: uuid::Uuid,
    session_id: uuid::Uuid,
    account_ref: String,
    origins: Vec<String>,
    recipes: Vec<AgentWebRecipePolicy>,
    allowed_output_fields: Vec<String>,
    max_output_bytes: usize,
    expires_at: u64,
    protected_targets: HashMap<String, ProtectedTarget>,
    pending_passkeys: HashMap<String, PendingPasskeyRequest>,
    pending_download: Arc<Mutex<Option<PendingDownload>>>,
    canaries: Zeroizing<Vec<String>>,
    runtime_directory: PathBuf,
    window: WebviewWindow,
}

struct PendingPasskeyRequest {
    operation: &'static str,
    request_json: Zeroizing<String>,
    origin: String,
    completion_key: String,
    expires_at: u64,
    window: WebviewWindow,
}

impl Drop for PendingPasskeyRequest {
    fn drop(&mut self) {
        if !self.completion_key.is_empty() {
            let _ = self
                .window
                .eval(passkey_rejection_script(&self.completion_key));
        }
    }
}

struct ProtectedTarget {
    kind: AgentManagedWebProtectedKind,
    recipe_name: String,
}

struct PendingDownload {
    destination: PathBuf,
    sender: SyncSender<Result<PathBuf, ()>>,
}

impl Drop for ManagedWebSession {
    fn drop(&mut self) {
        if let Ok(mut pending) = self.pending_download.lock() {
            pending.take();
        }
        let _ = self.window.close();
        let _ = fs::remove_dir_all(&self.runtime_directory);
    }
}

impl AgentManagedWebStore {
    pub(crate) fn open(
        &mut self,
        app: &AppHandle,
        plan: AgentManagedWebOpenPlan,
        scope: &AgentExecutionScope,
        account_ref: &str,
        now_millis: u64,
        cancellation: &AtomicBool,
    ) -> Result<Value, &'static str> {
        self.prune(now_millis);
        if self.sessions.len() >= MAX_SESSIONS
            || self
                .sessions
                .values()
                .any(|session| session.session_id == scope.session_id)
        {
            return Err("web-session-quota-exceeded");
        }
        let login = plan
            .recipes
            .iter()
            .find(|recipe| recipe.kind == AgentWebRecipeKind::Login)
            .cloned()
            .ok_or("web-policy-invalid")?;
        let primary_origin = plan.origins.first().ok_or("web-policy-invalid")?;
        let login_url = approved_url(primary_origin, &login.path, &plan.origins)?;
        let session_id = uuid::Uuid::new_v4();
        let session_ref = format!("web_{}", session_id.simple());
        let label = format!("agent-web-{}", session_id.simple());
        let runtime_directory = plan.runtime_root.join(session_id.simple().to_string());
        create_private_directory(&runtime_directory)?;
        let pending_download = Arc::new(Mutex::new(None::<PendingDownload>));
        let (loaded_sender, loaded_receiver) = sync_channel(8);
        let navigation_origins = plan.origins.clone();
        let download_state = Arc::clone(&pending_download);
        let download_origins = plan.origins.clone();
        let window = WebviewWindowBuilder::new(app, label, WebviewUrl::External(login_url))
            .title("VaultMesh Managed Session")
            .visible(false)
            .decorations(false)
            .skip_taskbar(true)
            .content_protected(true)
            .incognito(true)
            .on_navigation(move |url| origin_allowed(url, &navigation_origins))
            .on_new_window(|_, _| NewWindowResponse::Deny)
            .on_page_load(move |_window, payload| {
                if payload.event() == PageLoadEvent::Finished {
                    let _ = loaded_sender.try_send(payload.url().clone());
                }
            })
            .on_download(move |_webview, event| match event {
                DownloadEvent::Requested { url, destination } => {
                    if !origin_allowed(&url, &download_origins) {
                        return false;
                    }
                    let Ok(pending) = download_state.lock() else {
                        return false;
                    };
                    let Some(pending) = pending.as_ref() else {
                        return false;
                    };
                    *destination = pending.destination.clone();
                    true
                }
                DownloadEvent::Finished { path, success, .. } => {
                    if let Ok(mut pending) = download_state.lock()
                        && let Some(pending) = pending.take()
                    {
                        let result = path
                            .filter(|path| success && path == &pending.destination)
                            .ok_or(());
                        let _ = pending.sender.try_send(result);
                    }
                    true
                }
                _ => false,
            })
            .build()
            .map_err(|_| "web-session-unavailable")?;
        wait_for_page_load(
            &loaded_receiver,
            &plan.origins,
            cancellation,
            OPERATION_TIMEOUT,
        )?;
        let login_result = run_script_callback(
            &window,
            login_script(&login, &plan.username, &plan.password)?,
            cancellation,
        )?;
        if login_result.get("status").and_then(Value::as_str) != Some("submitted") {
            let _ = window.close();
            let _ = fs::remove_dir_all(&runtime_directory);
            return Err("web-login-failed");
        }
        wait_for_recipe_result(&window, &login, cancellation, "web-login-failed")?;
        let canaries = Zeroizing::new(vec![plan.username.to_string(), plan.password.to_string()]);
        let expires_at = now_millis.saturating_add(SESSION_TTL_MILLIS);
        let mut protected_targets = HashMap::new();
        let mut protected_target_summaries = Vec::new();
        for recipe in &plan.recipes {
            let kind = match recipe.kind {
                AgentWebRecipeKind::Totp => AgentManagedWebProtectedKind::Totp,
                AgentWebRecipeKind::EmailOtp => AgentManagedWebProtectedKind::EmailOtp,
                AgentWebRecipeKind::RecoveryCode => AgentManagedWebProtectedKind::RecoveryCode,
                _ => continue,
            };
            let target_ref = format!("webt_{}", uuid::Uuid::new_v4().simple());
            protected_targets.insert(
                target_ref.clone(),
                ProtectedTarget {
                    kind,
                    recipe_name: recipe.name.clone(),
                },
            );
            protected_target_summaries.push(json!({
                "kind": protected_kind_name(kind),
                "targetRef": target_ref,
            }));
        }
        self.sessions.insert(
            session_ref.clone(),
            ManagedWebSession {
                client_id: scope.client_id,
                session_id: scope.session_id,
                account_ref: account_ref.to_owned(),
                origins: plan.origins,
                recipes: plan.recipes,
                allowed_output_fields: plan.allowed_output_fields,
                max_output_bytes: plan.max_output_bytes,
                expires_at,
                protected_targets,
                pending_passkeys: HashMap::new(),
                pending_download,
                canaries,
                runtime_directory,
                window,
            },
        );
        Ok(json!({
            "sessionRef": session_ref,
            "status": "authenticated",
            "expiresAt": expires_at,
            "definitionRef": plan.definition_id,
            "protectedTargets": protected_target_summaries
        }))
    }

    pub(crate) fn navigate(
        &mut self,
        session_ref: &str,
        route: &str,
        scope: &AgentExecutionScope,
        account_ref: &str,
        cancellation: &AtomicBool,
    ) -> Result<Value, &'static str> {
        let session = self.bound_session_mut(session_ref, scope, account_ref)?;
        session.pending_passkeys.clear();
        let recipe = recipe(session, route, AgentWebRecipeKind::Navigate)?;
        let url = approved_url(&session.origins[0], &recipe.path, &session.origins)?;
        session
            .window
            .navigate(url.clone())
            .map_err(|_| "web-navigation-failed")?;
        wait_until_url(&session.window, &url, cancellation)?;
        wait_for_document_ready(&session.window, cancellation)?;
        Ok(json!({ "sessionRef": session_ref, "status": "navigated", "route": route }))
    }

    pub(crate) fn extract(
        &mut self,
        session_ref: &str,
        recipe_name: &str,
        scope: &AgentExecutionScope,
        account_ref: &str,
        cancellation: &AtomicBool,
    ) -> Result<Value, &'static str> {
        let session = self.bound_session_mut(session_ref, scope, account_ref)?;
        let recipe = recipe(session, recipe_name, AgentWebRecipeKind::Extract)?;
        ensure_current_recipe_path(session, &recipe)?;
        let value = run_script_callback(&session.window, extract_script(&recipe)?, cancellation)?;
        let fields = validate_extracted_fields(session, &recipe, value)?;
        Ok(json!({ "sessionRef": session_ref, "recipe": recipe_name, "fields": fields }))
    }

    pub(crate) fn act(
        &mut self,
        session_ref: &str,
        recipe_name: &str,
        input: &Value,
        scope: &AgentExecutionScope,
        account_ref: &str,
        cancellation: &AtomicBool,
    ) -> Result<Value, &'static str> {
        let session = self.bound_session_mut(session_ref, scope, account_ref)?;
        let recipe = recipe(session, recipe_name, AgentWebRecipeKind::Action)?;
        ensure_current_recipe_path(session, &recipe)?;
        let safe_input = validate_action_input(&recipe, input)?;
        let result = run_script_callback(
            &session.window,
            action_script(&recipe, &safe_input)?,
            cancellation,
        )?;
        if result.get("status").and_then(Value::as_str) != Some("submitted") {
            return Err("web-action-failed");
        }
        wait_for_recipe_result(&session.window, &recipe, cancellation, "web-action-failed")?;
        Ok(json!({ "sessionRef": session_ref, "recipe": recipe_name, "status": "completed" }))
    }

    pub(crate) fn download(
        &mut self,
        session_ref: &str,
        recipe_name: &str,
        scope: &AgentExecutionScope,
        account_ref: &str,
        cancellation: &AtomicBool,
    ) -> Result<AgentManagedWebDownload, &'static str> {
        let session = self.bound_session_mut(session_ref, scope, account_ref)?;
        let recipe = recipe(session, recipe_name, AgentWebRecipeKind::Download)?;
        ensure_current_recipe_path(session, &recipe)?;
        let download_id = uuid::Uuid::new_v4().simple().to_string();
        let destination = session
            .runtime_directory
            .join(format!("download-{download_id}"));
        let (sender, receiver) = sync_channel(1);
        {
            let mut pending = session
                .pending_download
                .lock()
                .map_err(|_| "web-download-failed")?;
            if pending.is_some() {
                return Err("web-session-busy");
            }
            *pending = Some(PendingDownload {
                destination: destination.clone(),
                sender,
            });
        }
        let click = run_script_callback(&session.window, click_script(&recipe)?, cancellation)?;
        if click.get("status").and_then(Value::as_str) != Some("clicked") {
            if let Ok(mut pending) = session.pending_download.lock() {
                pending.take();
            }
            return Err("web-download-failed");
        }
        let path = wait_for_download(&receiver, cancellation).inspect_err(|_| {
            if let Ok(mut pending) = session.pending_download.lock() {
                pending.take();
            }
        })?;
        let (basename, mime, bytes) = load_selected_file(&path)?;
        let _ = fs::remove_file(&path);
        if contains_canary(bytes.as_slice(), &session.canaries) {
            return Err("web-secret-detected");
        }
        Ok(AgentManagedWebDownload {
            basename,
            mime,
            bytes,
        })
    }

    pub(crate) fn close(
        &mut self,
        session_ref: &str,
        scope: &AgentExecutionScope,
        account_ref: &str,
    ) -> Result<Value, &'static str> {
        self.bound_session(session_ref, scope, account_ref)?;
        self.sessions.remove(session_ref);
        Ok(json!({ "sessionRef": session_ref, "closed": true }))
    }

    pub(crate) fn begin_passkey_request(
        &mut self,
        session_ref: &str,
        recipe_name: &str,
        scope: &AgentExecutionScope,
        account_ref: &str,
        now_millis: u64,
        cancellation: &AtomicBool,
    ) -> Result<Value, &'static str> {
        let session = self.bound_session_mut(session_ref, scope, account_ref)?;
        session
            .pending_passkeys
            .retain(|_, pending| pending.expires_at > now_millis);
        if !session.pending_passkeys.is_empty() {
            return Err("web-session-busy");
        }
        let recipe = session
            .recipes
            .iter()
            .find(|recipe| {
                recipe.name == recipe_name
                    && matches!(
                        recipe.kind,
                        AgentWebRecipeKind::PasskeyRegistration
                            | AgentWebRecipeKind::PasskeyAssertion
                    )
            })
            .cloned()
            .ok_or("web-policy-denied")?;
        ensure_current_recipe_path(session, &recipe)?;
        let operation = match recipe.kind {
            AgentWebRecipeKind::PasskeyRegistration => "create",
            AgentWebRecipeKind::PasskeyAssertion => "get",
            _ => return Err("web-policy-denied"),
        };
        let completion_key = format!("vaultmesh-passkey-{}", uuid::Uuid::new_v4().simple());
        let value = match run_script_callback(
            &session.window,
            passkey_capture_script(&recipe, operation, &completion_key)?,
            cancellation,
        ) {
            Ok(value) => value,
            Err(error) => {
                let _ = session
                    .window
                    .eval(passkey_rejection_script(&completion_key));
                return Err(error);
            }
        };
        let request_json = value
            .get("requestDetailsJson")
            .and_then(Value::as_str)
            .filter(|value| value.len() <= 128 * 1024)
            .ok_or("passkey-request-invalid")?;
        let origin = session
            .window
            .url()
            .map_err(|_| "web-navigation-failed")?
            .origin()
            .ascii_serialization();
        let request_ref = format!("webauthn_{}", uuid::Uuid::new_v4().simple());
        let expires_at = now_millis.saturating_add(PASSKEY_REQUEST_TTL_MILLIS);
        session.pending_passkeys.insert(
            request_ref.clone(),
            PendingPasskeyRequest {
                operation,
                request_json: Zeroizing::new(request_json.to_owned()),
                origin,
                completion_key,
                expires_at,
                window: session.window.clone(),
            },
        );
        Ok(json!({
            "requestRef": request_ref,
            "operation": operation,
            "expiresAt": expires_at
        }))
    }

    pub(crate) fn passkey_request_description(
        &self,
        request_ref: &str,
        scope: &AgentExecutionScope,
        account_ref: &str,
        now_millis: u64,
    ) -> Result<(&'static str, Zeroizing<String>, String), &'static str> {
        let pending = self
            .sessions
            .values()
            .filter(|session| {
                session.client_id == scope.client_id
                    && session.session_id == scope.session_id
                    && session.account_ref == account_ref
            })
            .find_map(|session| session.pending_passkeys.get(request_ref))
            .filter(|pending| pending.expires_at > now_millis)
            .ok_or("passkey-request-unavailable")?;
        Ok((
            pending.operation,
            Zeroizing::new(pending.request_json.to_string()),
            pending.origin.clone(),
        ))
    }

    pub(crate) fn take_passkey_request(
        &mut self,
        request_ref: &str,
        scope: &AgentExecutionScope,
        account_ref: &str,
        now_millis: u64,
        cancellation: &AtomicBool,
    ) -> Result<AgentManagedWebPasskeyRequest, &'static str> {
        let session = self
            .sessions
            .values_mut()
            .find(|session| {
                session.client_id == scope.client_id
                    && session.session_id == scope.session_id
                    && session.account_ref == account_ref
                    && session.pending_passkeys.contains_key(request_ref)
            })
            .ok_or("passkey-request-unavailable")?;
        let pending = session
            .pending_passkeys
            .get(request_ref)
            .ok_or("passkey-request-unavailable")?;
        if pending.expires_at <= now_millis {
            session.pending_passkeys.remove(request_ref);
            return Err("passkey-request-unavailable");
        }
        let page_state = run_script_callback(
            &pending.window,
            passkey_pending_script(&pending.completion_key),
            cancellation,
        )?;
        if page_state.get("status").and_then(Value::as_str) != Some("active") {
            session.pending_passkeys.remove(request_ref);
            return Err("passkey-request-unavailable");
        }
        let mut pending = session
            .pending_passkeys
            .remove(request_ref)
            .ok_or("passkey-request-unavailable")?;
        let request = AgentManagedWebPasskeyRequest {
            operation: pending.operation,
            request_json: Zeroizing::new(std::mem::take(&mut *pending.request_json)),
            origin: std::mem::take(&mut pending.origin),
            completion_key: std::mem::take(&mut pending.completion_key),
            window: pending.window.clone(),
            terminal: false,
        };
        // Prevent PendingPasskeyRequest::drop from rejecting the page after ownership transfer.
        pending.completion_key.clear();
        Ok(request)
    }

    pub(crate) fn protected_target_info(
        &self,
        target_ref: &str,
        scope: &AgentExecutionScope,
        account_ref: &str,
    ) -> Result<(AgentManagedWebProtectedKind, String), &'static str> {
        let session = self
            .sessions
            .values()
            .find(|session| {
                session.expires_at > current_millis()
                    && session.client_id == scope.client_id
                    && session.session_id == scope.session_id
                    && session.account_ref == account_ref
                    && session.protected_targets.contains_key(target_ref)
            })
            .ok_or("web-target-unavailable")?;
        let target = session
            .protected_targets
            .get(target_ref)
            .ok_or("web-target-unavailable")?;
        Ok((
            target.kind,
            session
                .origins
                .first()
                .cloned()
                .ok_or("web-policy-invalid")?,
        ))
    }

    pub(crate) fn fill_protected(
        &mut self,
        target_ref: &str,
        expected_kind: AgentManagedWebProtectedKind,
        value: Zeroizing<String>,
        scope: &AgentExecutionScope,
        account_ref: &str,
        cancellation: &AtomicBool,
    ) -> Result<(), &'static str> {
        let session = self
            .sessions
            .values_mut()
            .find(|session| {
                session.expires_at > current_millis()
                    && session.client_id == scope.client_id
                    && session.session_id == scope.session_id
                    && session.account_ref == account_ref
                    && session.protected_targets.contains_key(target_ref)
            })
            .ok_or("web-target-unavailable")?;
        let recipe_name = session
            .protected_targets
            .get(target_ref)
            .filter(|target| target.kind == expected_kind)
            .map(|target| target.recipe_name.clone())
            .ok_or("web-target-kind-mismatch")?;
        let recipe = recipe(session, &recipe_name, recipe_kind(expected_kind))?;
        ensure_current_recipe_path(session, &recipe)?;
        let result = run_script_callback(
            &session.window,
            protected_fill_script(&recipe, value.as_str())?,
            cancellation,
        )?;
        if result.get("status").and_then(Value::as_str) != Some("submitted") {
            return Err("web-protected-submit-failed");
        }
        wait_for_recipe_result(
            &session.window,
            &recipe,
            cancellation,
            "web-protected-submit-failed",
        )?;
        session.protected_targets.remove(target_ref);
        Ok(())
    }

    pub(crate) fn revoke_client(&mut self, client_id: uuid::Uuid) {
        self.sessions
            .retain(|_, session| session.client_id != client_id);
    }

    pub(crate) fn revoke_session(&mut self, session_id: uuid::Uuid) {
        self.sessions
            .retain(|_, session| session.session_id != session_id);
    }

    pub(crate) fn prune(&mut self, now_millis: u64) {
        self.sessions
            .retain(|_, session| session.expires_at > now_millis);
    }

    pub(crate) fn clear(&mut self) {
        self.sessions.clear();
    }

    fn bound_session(
        &self,
        session_ref: &str,
        scope: &AgentExecutionScope,
        account_ref: &str,
    ) -> Result<&ManagedWebSession, &'static str> {
        self.sessions
            .get(session_ref)
            .filter(|session| {
                session.expires_at > current_millis()
                    && session.client_id == scope.client_id
                    && session.session_id == scope.session_id
                    && session.account_ref == account_ref
            })
            .ok_or("web-session-unavailable")
    }

    fn bound_session_mut(
        &mut self,
        session_ref: &str,
        scope: &AgentExecutionScope,
        account_ref: &str,
    ) -> Result<&mut ManagedWebSession, &'static str> {
        self.sessions
            .get_mut(session_ref)
            .filter(|session| {
                session.expires_at > current_millis()
                    && session.client_id == scope.client_id
                    && session.session_id == scope.session_id
                    && session.account_ref == account_ref
            })
            .ok_or("web-session-unavailable")
    }
}
