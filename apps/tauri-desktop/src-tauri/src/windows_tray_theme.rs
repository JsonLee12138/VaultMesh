pub(crate) const WINDOWS_LIGHT_TRAY_ICON_BYTES: &[u8] =
    include_bytes!("../../resources/tray-icon-windows-light.png");
pub(crate) const WINDOWS_DARK_TRAY_ICON_BYTES: &[u8] =
    include_bytes!("../../resources/tray-icon-windows-dark.png");

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WindowsSystemTheme {
    Light,
    Dark,
}

pub(crate) fn theme_from_system_uses_light_theme(value: Option<u32>) -> WindowsSystemTheme {
    match value {
        Some(1) => WindowsSystemTheme::Light,
        Some(0) | Some(_) | None => WindowsSystemTheme::Dark,
    }
}

pub(crate) fn icon_bytes_for_theme(theme: WindowsSystemTheme) -> &'static [u8] {
    match theme {
        WindowsSystemTheme::Light => WINDOWS_LIGHT_TRAY_ICON_BYTES,
        WindowsSystemTheme::Dark => WINDOWS_DARK_TRAY_ICON_BYTES,
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use crate::DESKTOP_TRAY_ID;
    use std::{ptr, thread};
    use tauri::{AppHandle, image::Image};
    use windows_sys::Win32::{
        Foundation::ERROR_SUCCESS,
        System::Registry::{
            HKEY, HKEY_CURRENT_USER, KEY_NOTIFY, KEY_QUERY_VALUE, REG_DWORD,
            REG_NOTIFY_CHANGE_LAST_SET, RegCloseKey, RegNotifyChangeKeyValue, RegOpenKeyExW,
            RegQueryValueExW,
        },
    };

    const PERSONALIZE_SUBKEY: &str =
        "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
    const SYSTEM_USES_LIGHT_THEME: &str = "SystemUsesLightTheme";

    struct RegistryKey(HKEY);

    impl Drop for RegistryKey {
        fn drop(&mut self) {
            // SAFETY: `self.0` is a successful `RegOpenKeyExW` result owned by this guard.
            unsafe {
                RegCloseKey(self.0);
            }
        }
    }

    fn wide_null(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn open_personalize_key() -> Option<RegistryKey> {
        let subkey = wide_null(PERSONALIZE_SUBKEY);
        let mut key = ptr::null_mut();
        // SAFETY: `subkey` is NUL-terminated and `key` points to writable storage.
        let status = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                0,
                KEY_QUERY_VALUE | KEY_NOTIFY,
                &mut key,
            )
        };
        (status == ERROR_SUCCESS && !key.is_null()).then_some(RegistryKey(key))
    }

    fn query_system_uses_light_theme(key: &RegistryKey) -> Option<u32> {
        let value_name = wide_null(SYSTEM_USES_LIGHT_THEME);
        let mut value_type = 0;
        let mut value = 0_u32;
        let mut value_size = std::mem::size_of::<u32>() as u32;
        // SAFETY: all pointers reference initialized writable storage of the declared size.
        let status = unsafe {
            RegQueryValueExW(
                key.0,
                value_name.as_ptr(),
                ptr::null(),
                &mut value_type,
                (&mut value as *mut u32).cast::<u8>(),
                &mut value_size,
            )
        };
        (status == ERROR_SUCCESS
            && value_type == REG_DWORD
            && value_size == std::mem::size_of::<u32>() as u32)
            .then_some(value)
    }

    fn current_theme_from_key(key: Option<&RegistryKey>) -> WindowsSystemTheme {
        theme_from_system_uses_light_theme(key.and_then(query_system_uses_light_theme))
    }

    fn set_tray_theme(app: &AppHandle, theme: WindowsSystemTheme) {
        let Some(tray) = app.tray_by_id(DESKTOP_TRAY_ID) else {
            return;
        };
        let Ok(icon) = Image::from_bytes(icon_bytes_for_theme(theme)) else {
            return;
        };
        let _ = tray.set_icon(Some(icon));
    }

    pub(super) fn current_tray_icon() -> tauri::Result<Image<'static>> {
        let key = open_personalize_key();
        Image::from_bytes(icon_bytes_for_theme(current_theme_from_key(key.as_ref())))
    }

    pub(super) fn start_tray_theme_watcher(app: AppHandle) {
        let watcher_app = app.clone();
        let watcher = thread::Builder::new()
            .name("vaultmesh-windows-tray-theme".to_owned())
            .spawn(move || {
                let Some(key) = open_personalize_key() else {
                    set_tray_theme(&watcher_app, WindowsSystemTheme::Dark);
                    return;
                };
                let mut applied_theme = None;
                loop {
                    let theme = current_theme_from_key(Some(&key));
                    if applied_theme != Some(theme) {
                        set_tray_theme(&watcher_app, theme);
                        applied_theme = Some(theme);
                    }

                    // SAFETY: `key` remains open for the whole loop; synchronous notification
                    // requires no event handle and returns after the watched value changes.
                    let status = unsafe {
                        RegNotifyChangeKeyValue(
                            key.0,
                            0,
                            REG_NOTIFY_CHANGE_LAST_SET,
                            ptr::null_mut(),
                            0,
                        )
                    };
                    if status != ERROR_SUCCESS {
                        set_tray_theme(&watcher_app, WindowsSystemTheme::Dark);
                        break;
                    }
                }
            });
        if watcher.is_err() {
            set_tray_theme(&app, WindowsSystemTheme::Dark);
        }
    }
}

#[cfg(target_os = "windows")]
pub(crate) use platform::{current_tray_icon, start_tray_theme_watcher};
