use super::*;
use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const AGENT_PAIRING_WINDOW_LABEL: &str = "agent-pairing";

fn should_wake_pairing_window(visible: bool, minimized: bool) -> bool {
    !visible || minimized
}

fn require_pairing_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == AGENT_PAIRING_WINDOW_LABEL {
        Ok(())
    } else {
        Err("配对操作只能从 VaultMesh 系统配对窗口发起。".to_owned())
    }
}

fn pending_pairing_request(broker: &mut AgentBrokerCore) -> Option<Value> {
    broker
        .pending_pairing_request(unix_millis())
        .and_then(|request| serde_json::to_value(request).ok())
}

#[tauri::command]
pub(super) async fn agent_pairing_status(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
) -> Result<Value, String> {
    require_pairing_window(&window)?;
    let request = state
        .agent_broker
        .lock()
        .map_err(|_| "Agent 能力代理暂时不可用。".to_owned())
        .map(|mut broker| pending_pairing_request(&mut broker))?;
    *state
        .agent_pairing_window_request
        .lock()
        .map_err(|_| "Agent 配对窗口状态暂时不可用。".to_owned())? = request
        .as_ref()
        .and_then(|request| request["clientId"].as_str().map(str::to_owned));
    Ok(json!({
        "request": request,
    }))
}

#[tauri::command]
pub(super) async fn agent_pairing_resolve(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    client_id: String,
    approved: bool,
) -> Result<Value, String> {
    require_pairing_window(&window)?;
    let displayed_request = state
        .agent_pairing_window_request
        .lock()
        .map_err(|_| "Agent 配对窗口状态暂时不可用。".to_owned())?
        .clone();
    if displayed_request.as_deref() != Some(client_id.as_str()) {
        return Err("配对申请已经变化，请重试。".to_owned());
    }
    if approved {
        let mut broker = state
            .agent_broker
            .lock()
            .map_err(|_| "Agent 能力代理暂时不可用。".to_owned())?;
        broker
            .approve_pairing_request_at(&client_id, unix_millis())
            .map_err(|error| format!("Agent 操作被拒绝：{}", error.code))?;
    } else {
        state
            .agent_broker
            .lock()
            .map_err(|_| "Agent 能力代理暂时不可用。".to_owned())?
            .reject_pairing_request(&client_id)
            .map_err(|error| format!("Agent 操作被拒绝：{}", error.code))?;
    }
    *state
        .agent_pairing_window_request
        .lock()
        .map_err(|_| "Agent 配对窗口状态暂时不可用。".to_owned())? = None;
    state.last_activity.store(unix_millis(), Ordering::Relaxed);
    Ok(json!({ "approved": approved }))
}

pub(super) fn show_agent_pairing_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(AGENT_PAIRING_WINDOW_LABEL) {
        if !should_wake_pairing_window(
            window.is_visible().unwrap_or(false),
            window.is_minimized().unwrap_or(false),
        ) {
            return;
        }
        #[cfg(target_os = "macos")]
        let _ = app.set_dock_visibility(true);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit_to(AGENT_PAIRING_WINDOW_LABEL, "agent-pairing-requested", ());
        return;
    }
    #[cfg(target_os = "macos")]
    let _ = app.set_dock_visibility(true);
    if let Ok(window) = WebviewWindowBuilder::new(
        app,
        AGENT_PAIRING_WINDOW_LABEL,
        WebviewUrl::App("index.html?surface=agent-pairing".into()),
    )
    .title("VaultMesh Agent 配对")
    .inner_size(460.0, 340.0)
    .min_inner_size(420.0, 320.0)
    .resizable(false)
    .always_on_top(true)
    .content_protected(true)
    .center()
    .build()
    {
        let _ = window.set_focus();
    }
}

pub(super) fn reject_displayed_pairing_on_window_close(state: &RuntimeState) {
    let displayed = state
        .agent_pairing_window_request
        .lock()
        .ok()
        .and_then(|mut request| request.take());
    if let Some(client_id) = displayed
        && let Ok(mut broker) = state.agent_broker.lock()
    {
        let _ = broker.reject_pairing_request(&client_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_window_has_a_dedicated_minimum_capability() {
        let capability: Value =
            serde_json::from_str(include_str!("../capabilities/agent-pairing.json")).unwrap();
        assert_eq!(capability["windows"], json!([AGENT_PAIRING_WINDOW_LABEL]));
        assert_eq!(
            capability["permissions"],
            json!([
                "core:event:default",
                "core:window:allow-close",
                "allow-agent-pairing-status",
                "allow-agent-pairing-resolve"
            ])
        );
    }

    #[test]
    fn visible_pairing_window_is_not_repeatedly_focused_or_refreshed() {
        assert!(!should_wake_pairing_window(true, false));
        assert!(should_wake_pairing_window(false, false));
        assert!(should_wake_pairing_window(true, true));
    }
}
