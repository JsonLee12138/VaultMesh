//! Main-window-only authentication. MCP/browser retain their independent factor flows.
use super::*;
use platform::{AuthenticationAdapter, PlatformAdapter};
use tauri::WebviewWindow;
use uuid::Uuid;
mod platform;

#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
impl Bounds {
    fn valid(self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite())
            && self.x >= 0.0
            && self.y >= 0.0
            && (24.0..=128.0).contains(&self.width)
            && (24.0..=128.0).contains(&self.height)
            && self.x <= 10_000.0
            && self.y <= 10_000.0
    }
}
#[derive(Clone)]
struct Page {
    id: String,
    bounds: Bounds,
    vault: PathBuf,
    credential_id: String,
}
#[derive(Default)]
pub(super) struct Coordinator {
    page: Option<Page>,
    generation: u64,
    listening: bool,
}
impl Coordinator {
    fn invalidate(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.listening = false;
    }
    fn register(&mut self, page: Page) {
        if self.page.as_ref().is_some_and(|current| {
            current.id == page.id
                && current.vault == page.vault
                && current.credential_id == page.credential_id
        }) {
            return;
        }
        self.invalidate();
        self.page = Some(page);
    }
    fn accepts(&self, generation: u64) -> bool {
        self.page.is_some() && self.listening && self.generation == generation
    }
}
fn require_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("此认证只允许主窗口使用。".into())
    }
}
fn emit(window: &WebviewWindow, id: &str, status: &str) {
    emit_with_message(window, id, status, None);
}
fn emit_with_message(window: &WebviewWindow, id: &str, status: &str, message: Option<&str>) {
    let _ = window.emit(
        "desktop-authentication",
        json!({"sessionId": id, "status": status, "message": message}),
    );
}
#[tauri::command]
pub(super) fn desktop_authentication_status(window: WebviewWindow) -> Result<Value, String> {
    require_main(&window)?;
    Ok(json!({ "supported": PlatformAdapter::SUPPORTED, "label": PlatformAdapter::LABEL }))
}
#[tauri::command]
pub(super) fn desktop_authentication_begin(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    session_id: String,
    bounds: Bounds,
) -> Result<(), String> {
    require_main(&window)?;
    if Uuid::parse_str(&session_id).is_err() || !bounds.valid() {
        return Err("认证参数无效。".into());
    }
    if !PlatformAdapter::SUPPORTED {
        return Err(PlatformAdapter::LABEL.into());
    }
    let runtime = state.runtime.lock().map_err(|_| "保险库暂时不可用。")?;
    if runtime.status().unlocked || !runtime.status().has_vault {
        return Err("当前无需解锁。".into());
    }
    let vault = runtime
        .current_path()
        .canonicalize()
        .map_err(|_| "无法定位保险库。")?;
    drop(runtime);
    let (credential_vault, credential_id) = state
        .biometric
        .lock()
        .map_err(|_| "认证暂时不可用。")?
        .credential_binding()?;
    if credential_vault != vault {
        return Err("Touch ID 凭据不属于当前保险库。".into());
    }
    {
        let mut coordinator = state
            .desktop_authentication
            .lock()
            .map_err(|_| "认证暂时不可用。")?;
        coordinator.register(Page {
            id: session_id,
            bounds,
            vault,
            credential_id,
        });
    }
    resume(&window);
    Ok(())
}
#[tauri::command]
pub(super) fn desktop_authentication_layout(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    session_id: String,
    bounds: Bounds,
) -> Result<(), String> {
    require_main(&window)?;
    if !bounds.valid() {
        return Err("认证布局无效。".into());
    }
    let mut coordinator = state
        .desktop_authentication
        .lock()
        .map_err(|_| "认证暂时不可用。")?;
    if let Some(page) = coordinator.page.as_mut().filter(|p| p.id == session_id) {
        page.bounds = bounds;
    } else {
        return Ok(());
    }
    drop(coordinator);
    let app = window.app_handle().clone();
    window
        .run_on_main_thread(move || {
            if let Some(state) = app.try_state::<RuntimeState>() {
                let Ok(coordinator) = state.desktop_authentication.lock() else {
                    return;
                };
                if coordinator.listening
                    && coordinator
                        .page
                        .as_ref()
                        .is_some_and(|p| p.id == session_id)
                {
                    PlatformAdapter::layout(bounds);
                }
            }
        })
        .map_err(|_| "无法更新认证布局。".into())
}
#[tauri::command]
pub(super) fn desktop_authentication_cancel(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    session_id: String,
) -> Result<(), String> {
    require_main(&window)?;
    cancel(&window, &state, Some(&session_id), true);
    Ok(())
}
fn cancel(window: &WebviewWindow, state: &RuntimeState, id: Option<&str>, remove: bool) {
    if let Ok(mut coordinator) = state.desktop_authentication.lock() {
        if id.is_some_and(|id| coordinator.page.as_ref().is_none_or(|p| p.id != id)) {
            return;
        }
        if coordinator.page.is_none() && !coordinator.listening {
            return;
        }
        if !remove && !coordinator.listening {
            return;
        }
        coordinator.invalidate();
        if let Some(page) = &coordinator.page {
            emit(window, &page.id, "paused");
        }
        if remove {
            coordinator.page = None;
        }
    }
    // Preserve ordering with a following begin. A queued old cancel must not remove a new view.
    let app = window.app_handle().clone();
    let _ = window.run_on_main_thread(move || {
        if let Some(state) = app.try_state::<RuntimeState>() {
            if let Ok(coordinator) = state.desktop_authentication.lock() {
                if !coordinator.listening {
                    PlatformAdapter::cancel();
                }
            }
        }
    });
}
pub(super) fn invalidate(app: &AppHandle, state: &RuntimeState) {
    if let Some(window) = app.get_webview_window("main") {
        cancel(&window, state, None, true);
    }
}
pub(super) fn suspend(app: &AppHandle, state: &RuntimeState) {
    if let Some(window) = app.get_webview_window("main") {
        cancel(&window, state, None, false);
    }
}
pub(super) fn window_event(window: &tauri::Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    let app = window.app_handle();
    let Some(webview) = app.get_webview_window("main") else {
        return;
    };
    let Some(state) = app.try_state::<RuntimeState>() else {
        return;
    };
    match event {
        WindowEvent::Focused(true) => {
            resume(&webview);
        }
        WindowEvent::Focused(false) => cancel(&webview, &state, None, false),
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
            cancel(&webview, &state, None, true)
        }
        _ => {}
    }
}
fn resume(window: &WebviewWindow) {
    let window = window.clone();
    let dispatcher = window.clone();
    let _ = dispatcher.run_on_main_thread(move || {
        let Some(state) = window.app_handle().try_state::<RuntimeState>() else {
            return;
        };
        if !window.is_focused().unwrap_or(false) || !window.is_visible().unwrap_or(false) {
            return;
        }
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if app_setup::system_session_locked() {
            return;
        }
        let (page, generation) = {
            let Ok(mut coordinator) = state.desktop_authentication.lock() else {
                return;
            };
            if coordinator.listening {
                return;
            }
            let Some(page) = coordinator.page.clone() else {
                return;
            };
            coordinator.invalidate();
            coordinator.listening = true;
            (page, coordinator.generation)
        };
        emit(&window, &page.id, "listening");
        let completed_window = window.clone();
        let reply =
            Box::new(move |outcome| complete(completed_window.clone(), generation, outcome));
        if let Err(error) = PlatformAdapter::begin(&window, page.bounds, reply) {
            complete(window, generation, Err(error));
        }
    });
}
fn complete(window: WebviewWindow, generation: u64, outcome: Result<(), String>) {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(state) = window.app_handle().try_state::<RuntimeState>() else {
            return;
        };
        let page = {
            let Ok(coordinator) = state.desktop_authentication.lock() else {
                return;
            };
            if !coordinator.accepts(generation) {
                return;
            }
            coordinator.page.clone().unwrap()
        };
        if outcome.is_ok() {
            emit(&window, &page.id, "opening");
        }
        // No coordinator/credential guard is held while OS authentication waits.
        // Keychain access also stays outside the coordinator: cancellation may win
        // while credentials are being read, in which case the local key is zeroized.
        let credential = (|| -> Result<_, String> {
            outcome?;
            let biometric = state.biometric.lock().map_err(|_| "认证暂时不可用。")?;
            if biometric.credential_binding()? != (page.vault.clone(), page.credential_id.clone()) {
                return Err("Touch ID 凭据已变化。".into());
            }
            biometric.credential_after_authentication()
        })();
        // Query AppKit before taking the coordinator; main-thread focus events
        // must remain able to invalidate the generation.
        let foreground =
            window.is_focused().unwrap_or(false) && window.is_visible().unwrap_or(false);
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let foreground = foreground && !app_setup::system_session_locked();
        let Ok(mut coordinator) = state.desktop_authentication.lock() else {
            return;
        };
        if !coordinator.accepts(generation) {
            return;
        }
        coordinator.invalidate();
        let result = (|| -> Result<(), String> {
            if !foreground {
                return Err("认证完成时窗口已失去激活状态，请重新激活后重试。".into());
            }
            let (path, key) = credential?;
            if path != page.vault {
                return Err("保险库已切换。".into());
            }
            let mut runtime = state.runtime.lock().map_err(|_| "保险库暂时不可用。")?;
            if runtime.current_path().canonicalize().ok().as_ref() != Some(&page.vault)
                || runtime.status().unlocked
            {
                return Err("认证会话已失效。".into());
            }
            runtime
                .unlock_with_biometric_key(path, key.as_slice())
                .map_err(|e| e.public_message().to_owned())?;
            state.last_activity.store(unix_millis(), Ordering::Relaxed);
            Ok(())
        })();
        if result.is_ok() {
            coordinator.page = None;
        }
        emit_with_message(
            &window,
            &page.id,
            if result.is_ok() { "unlocked" } else { "failed" },
            result.as_ref().err().map(String::as_str),
        );
        drop(coordinator);
        // Destroy the completed context, but never a newer attempt's context.
        let app = window.app_handle().clone();
        let _ = window.run_on_main_thread(move || {
            if let Some(state) = app.try_state::<RuntimeState>() {
                if let Ok(coordinator) = state.desktop_authentication.lock() {
                    if !coordinator.listening {
                        PlatformAdapter::cancel();
                    }
                }
            }
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ct_desktop_auth_001_cancel_and_replacement_reject_late_callbacks() {
        let mut c = Coordinator::default();
        c.page = Some(Page {
            id: Uuid::new_v4().to_string(),
            bounds: Bounds {
                x: 0.,
                y: 0.,
                width: 64.,
                height: 64.,
            },
            vault: PathBuf::from("/test"),
            credential_id: "test-credential".into(),
        });
        c.listening = true;
        let original = c.generation;
        assert!(c.accepts(original));
        c.invalidate();
        assert!(!c.accepts(original));
        c.listening = true;
        assert!(c.accepts(c.generation));
        assert!(!c.accepts(original));
        c.page = None;
        assert!(!c.accepts(c.generation));
    }
    #[test]
    fn ct_desktop_auth_001_duplicate_registration_preserves_current_attempt() {
        let mut c = Coordinator::default();
        let page = Page {
            id: Uuid::new_v4().to_string(),
            bounds: Bounds {
                x: 0.,
                y: 0.,
                width: 64.,
                height: 64.,
            },
            vault: PathBuf::from("/test"),
            credential_id: "test-credential".into(),
        };
        c.register(page.clone());
        c.listening = true;
        let generation = c.generation;
        c.register(page.clone());
        assert!(c.accepts(generation));
        c.register(Page {
            credential_id: "replacement-credential".into(),
            ..page.clone()
        });
        assert!(!c.accepts(generation));
        c.listening = true;
        let generation = c.generation;
        c.register(Page {
            id: Uuid::new_v4().to_string(),
            ..page
        });
        assert!(!c.accepts(generation));
    }
    #[test]
    fn ct_desktop_auth_001_native_commands_are_not_granted_to_agent_windows() {
        let main = include_str!("../../capabilities/main.json");
        assert!(main.contains("allow-desktop-authentication"));
        for isolated in [
            include_str!("../../capabilities/agent-unlock.json"),
            include_str!("../../capabilities/agent-pairing.json"),
            include_str!("../../capabilities/agent-authorization.json"),
        ] {
            assert!(!isolated.contains("allow-desktop-authentication"));
        }
    }
    #[test]
    fn ct_desktop_auth_001_bounds_reject_non_finite_and_unbounded_native_views() {
        let b = Bounds {
            x: 1.,
            y: 2.,
            width: 64.,
            height: 64.,
        };
        assert!(b.valid());
        assert!(!Bounds { x: f64::NAN, ..b }.valid());
        assert!(!Bounds { width: 5000., ..b }.valid());
        assert!(!Bounds { y: -1., ..b }.valid());
    }
}
