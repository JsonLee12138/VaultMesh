use super::*;
use tauri_plugin_updater::UpdaterExt;

const INITIAL_CHECK_DELAY: Duration = Duration::from_secs(10);
const UPDATE_CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const UPDATE_NETWORK_TIMEOUT: Duration = Duration::from_secs(30);
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(super) const CHECK_FOR_UPDATES_MENU_ID: &str = "vaultmesh-check-for-updates";
#[cfg(any(target_os = "macos", target_os = "windows"))]
const CHECK_FOR_UPDATES_MENU_LABEL: &str = "检查更新…";
#[cfg(target_os = "macos")]
const CHECK_FOR_UPDATES_MENU_POSITION: usize = 2;
#[cfg(any(target_os = "windows", test))]
const WINDOWS_HELP_MENU_LABEL: &str = "帮助(&H)";

static UPDATE_CHECK_GATE: UpdateCheckGate = UpdateCheckGate::new();

struct UpdateCheckGate(AtomicBool);

impl UpdateCheckGate {
    const fn new() -> Self {
        Self(AtomicBool::new(false))
    }

    fn try_enter(&self) -> Option<UpdateCheckLease<'_>> {
        self.0
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| UpdateCheckLease(&self.0))
    }
}

struct UpdateCheckLease<'a>(&'a AtomicBool);

impl Drop for UpdateCheckLease<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum UpdateCheckOrigin {
    Automatic,
    Manual,
}

pub(super) fn updater_enabled_for_build() -> bool {
    updater_build_flag(option_env!("VAULTMESH_UPDATER_ENABLED"))
}

fn updater_build_flag(value: Option<&str>) -> bool {
    value == Some("1")
}

impl UpdateCheckOrigin {
    fn reports_result(self) -> bool {
        self == Self::Manual
    }
}

#[cfg(target_os = "macos")]
pub(super) fn desktop_application_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    let app_menu = menu
        .items()?
        .into_iter()
        .next()
        .and_then(|item| item.as_submenu().cloned())
        .ok_or_else(|| std::io::Error::other("macOS application menu is unavailable"))?;
    let check_for_updates = MenuItem::with_id(
        app,
        CHECK_FOR_UPDATES_MENU_ID,
        CHECK_FOR_UPDATES_MENU_LABEL,
        true,
        None::<&str>,
    )?;
    app_menu.insert(&check_for_updates, CHECK_FOR_UPDATES_MENU_POSITION)?;
    Ok(menu)
}

#[cfg(target_os = "windows")]
pub(super) fn desktop_application_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    windows_application_menu(app)
}

// Compile this helper in tests on non-Windows hosts so its Tauri menu API usage
// remains type-checked even though final package acceptance still requires Windows.
#[cfg(any(target_os = "windows", test))]
fn windows_application_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let check_for_updates = MenuItem::with_id(
        app,
        CHECK_FOR_UPDATES_MENU_ID,
        CHECK_FOR_UPDATES_MENU_LABEL,
        true,
        None::<&str>,
    )?;
    let help_menu = Submenu::with_items(app, WINDOWS_HELP_MENU_LABEL, true, &[&check_for_updates])?;
    Menu::with_items(app, &[&help_menu])
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(super) fn handle_desktop_menu_event(app: &AppHandle, event_id: &str) {
    if event_id != CHECK_FOR_UPDATES_MENU_ID {
        return;
    }
    let Some(state) = app.try_state::<RuntimeState>() else {
        return;
    };
    start_manual_check(app.clone(), state.inner().clone());
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn start_manual_check(app: AppHandle, state: RuntimeState) {
    std::thread::spawn(move || {
        tauri::async_runtime::block_on(async move {
            if !updater_enabled_for_build() {
                show_update_message(
                    &app,
                    &state,
                    "检查更新",
                    "此构建未启用远程更新检查。请使用测试通道发行版。",
                )
                .await;
                return;
            }
            run_check(app, state, UpdateCheckOrigin::Manual).await;
        });
    });
}

pub(super) fn start_update_monitor(app: AppHandle, state: RuntimeState) {
    if !updater_enabled_for_build() {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(INITIAL_CHECK_DELAY);
        loop {
            tauri::async_runtime::block_on(run_check(
                app.clone(),
                state.clone(),
                UpdateCheckOrigin::Automatic,
            ));
            std::thread::sleep(UPDATE_CHECK_INTERVAL);
        }
    });
}

async fn run_check(app: AppHandle, state: RuntimeState, origin: UpdateCheckOrigin) {
    let Some(_lease) = UPDATE_CHECK_GATE.try_enter() else {
        if origin.reports_result() {
            show_update_message(
                &app,
                &state,
                "正在检查更新",
                "VaultMesh 正在检查更新，请稍候。",
            )
            .await;
        }
        return;
    };
    check_once(app, state, origin).await;
}

async fn check_once(app: AppHandle, state: RuntimeState, origin: UpdateCheckOrigin) {
    let before_exit = app.clone();
    let updater = match app
        .updater_builder()
        .timeout(UPDATE_NETWORK_TIMEOUT)
        .on_before_exit(move || app_setup::cleanup_app_state(&before_exit))
        .build()
    {
        Ok(updater) => updater,
        Err(_) => {
            if origin.reports_result() {
                show_update_message(
                    &app,
                    &state,
                    "检查更新失败",
                    "无法准备更新检查，请稍后重试。",
                )
                .await;
            }
            return;
        }
    };
    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            if origin.reports_result() {
                let message = format!("VaultMesh {} 已是最新版本。", app.package_info().version);
                show_update_message(&app, &state, "没有可用更新", message).await;
            }
            return;
        }
        Err(_) => {
            if origin.reports_result() {
                show_update_message(
                    &app,
                    &state,
                    "检查更新失败",
                    "无法连接更新服务，请检查网络后稍后重试。",
                )
                .await;
            }
            return;
        }
    };
    if !confirm_update(&app, &state, &update.version.to_string()).await {
        return;
    }

    let downloaded = update.download(|_, _| {}, || {}).await;
    let Ok(bytes) = downloaded else {
        show_update_message(
            &app,
            &state,
            "VaultMesh 更新失败",
            "无法下载或验证更新，请检查网络后稍后重试。",
        )
        .await;
        return;
    };

    app_setup::cleanup_app_state(&app);
    if update.install(bytes).is_err() {
        show_update_message(
            &app,
            &state,
            "VaultMesh 更新失败",
            "无法安装更新；VaultMesh 将重新启动并保持锁定。",
        )
        .await;
        app.request_restart();
        return;
    }
    #[cfg(not(target_os = "windows"))]
    app.request_restart();
}

async fn confirm_update(app: &AppHandle, state: &RuntimeState, version: &str) -> bool {
    let app_for_dialog = app.clone();
    let version = version.to_owned();
    let dialog_guard = state.native_dialog_focus.begin();
    tauri::async_runtime::spawn_blocking(move || {
        let _dialog_guard = dialog_guard;
        app_for_dialog
            .dialog()
            .message(format!(
                "VaultMesh {version} 已可用。立即更新会先锁定保险库并清理所有临时授权。"
            ))
            .title("发现 VaultMesh 更新")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "立即更新".into(),
                "稍后".into(),
            ))
            .blocking_show()
    })
    .await
    .unwrap_or(false)
}

async fn show_update_message(
    app: &AppHandle,
    state: &RuntimeState,
    title: impl Into<String>,
    message: impl Into<String>,
) {
    let app = app.clone();
    let title = title.into();
    let message = message.into();
    let dialog_guard = state.native_dialog_focus.begin();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let _dialog_guard = dialog_guard;
        app.dialog()
            .message(message)
            .title(title)
            .buttons(MessageDialogButtons::OkCustom("知道了".into()))
            .blocking_show()
    })
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_monitor_is_bounded_and_not_a_tight_loop() {
        assert!(INITIAL_CHECK_DELAY >= Duration::from_secs(5));
        assert!(UPDATE_CHECK_INTERVAL >= Duration::from_secs(60 * 60));
        assert!(UPDATE_NETWORK_TIMEOUT <= Duration::from_secs(60));
    }

    #[test]
    fn update_check_gate_rejects_overlap_and_reopens_after_completion() {
        let gate = UpdateCheckGate::new();
        let lease = gate.try_enter().expect("first update check");
        assert!(gate.try_enter().is_none());
        drop(lease);
        assert!(gate.try_enter().is_some());
    }

    #[test]
    fn only_manual_checks_report_no_update_or_check_failure() {
        assert!(UpdateCheckOrigin::Manual.reports_result());
        assert!(!UpdateCheckOrigin::Automatic.reports_result());
    }

    #[test]
    fn only_the_explicit_non_secret_build_flag_enables_updater_runtime() {
        assert!(updater_build_flag(Some("1")));
        assert!(!updater_build_flag(None));
        assert!(!updater_build_flag(Some("true")));
        assert!(!updater_build_flag(Some("0")));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_update_menu_uses_stable_native_contract() {
        assert_eq!(CHECK_FOR_UPDATES_MENU_ID, "vaultmesh-check-for-updates");
        assert_eq!(CHECK_FOR_UPDATES_MENU_LABEL, "检查更新…");
        assert_eq!(CHECK_FOR_UPDATES_MENU_POSITION, 2);
    }

    #[test]
    fn windows_update_menu_uses_stable_native_contract() {
        let _builder: fn(&AppHandle) -> tauri::Result<Menu<tauri::Wry>> = windows_application_menu;
        assert_eq!(CHECK_FOR_UPDATES_MENU_ID, "vaultmesh-check-for-updates");
        assert_eq!(CHECK_FOR_UPDATES_MENU_LABEL, "检查更新…");
        assert_eq!(WINDOWS_HELP_MENU_LABEL, "帮助(&H)");
    }
}
