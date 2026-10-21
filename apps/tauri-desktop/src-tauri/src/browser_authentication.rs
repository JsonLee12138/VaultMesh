//! Browser-only, key-free OS authentication sessions. The broker commits an unlock on poll.
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::AppHandle;
use uuid::Uuid;

const LIFETIME: Duration = Duration::from_secs(30);
const LEASE: Duration = Duration::from_secs(3);

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Binding(pub PathBuf, pub String);
impl Binding {
    pub(crate) fn matches(
        &self,
        current_vault: &std::path::Path,
        credential: Option<(PathBuf, String)>,
    ) -> bool {
        self.0 == current_vault
            && credential
                .as_ref()
                .is_some_and(|(path, id)| path == &self.0 && id == &self.1)
    }
}
struct Session {
    id: Uuid,
    nonce: Uuid,
    binding: Binding,
    deadline: Instant,
    lease: Instant,
    result: Option<Result<(), String>>,
}
#[derive(Default)]
pub(crate) struct Authentication(Mutex<Option<Session>>);
impl Authentication {
    fn register(&self, id: Uuid, binding: Binding, now: Instant) -> Result<Uuid, String> {
        let mut slot = self.0.lock().map_err(|_| "系统认证暂不可用。")?;
        if slot.is_some() {
            return Err("已有系统认证，请先取消或等待其结束。".into());
        }
        let nonce = Uuid::new_v4();
        *slot = Some(Session {
            id,
            nonce,
            binding,
            deadline: now + LIFETIME,
            lease: now + LEASE,
            result: None,
        });
        Ok(nonce)
    }
    fn complete(&self, nonce: Uuid, result: Result<(), String>) {
        if let Ok(mut slot) = self.0.lock() {
            if let Some(session) = slot.as_mut().filter(|s| s.nonce == nonce) {
                session.result = Some(result);
            }
        }
    }
    fn alive(&self, nonce: Uuid, now: Instant) -> bool {
        self.0.lock().ok().is_some_and(|slot| {
            slot.as_ref()
                .is_some_and(|s| s.nonce == nonce && now < s.deadline && now < s.lease)
        })
    }
    pub(crate) fn binding(&self, id: Uuid) -> Option<Binding> {
        self.0
            .lock()
            .ok()?
            .as_ref()
            .filter(|s| s.id == id)
            .map(|s| s.binding.clone())
    }
    pub(crate) fn poll(&self, id: Uuid, now: Instant) -> Result<Option<Binding>, String> {
        let mut slot = self.0.lock().map_err(|_| "系统认证暂不可用。")?;
        let session = slot
            .as_mut()
            .filter(|s| s.id == id)
            .ok_or("认证已取消或过期，请重试。")?;
        if now >= session.deadline || now >= session.lease {
            slot.take();
            return Err("Touch ID 验证已过期，请重试。".into());
        }
        session.lease = now + LEASE;
        match session.result.take() {
            None => Ok(None),
            Some(result) => {
                let session = slot.take().unwrap();
                result.map(|()| Some(session.binding))
            }
        }
    }
    pub(crate) fn begin(
        self: &Arc<Self>,
        app: &AppHandle,
        id: Uuid,
        binding: Binding,
    ) -> Result<(), String> {
        let nonce = self.register(id, binding, Instant::now())?;
        let state = Arc::clone(self);
        if app
            .run_on_main_thread(move || {
                if !state.alive(nonce, Instant::now()) {
                    return;
                }
                let callback_state = Arc::clone(&state);
                if let Err(error) = native::begin(
                    nonce,
                    Box::new(move |result| callback_state.complete(nonce, result)),
                ) {
                    state.complete(nonce, Err(error));
                }
            })
            .is_err()
        {
            self.cancel(app, Some(id));
            return Err("无法启动系统认证。".into());
        }
        let state = Arc::clone(self);
        let app = app.clone();
        std::thread::spawn(move || {
            while state.alive(nonce, Instant::now()) {
                std::thread::sleep(Duration::from_millis(250));
            }
            if let Ok(mut slot) = state.0.lock() {
                if slot.as_ref().is_some_and(|s| s.nonce == nonce) {
                    slot.take();
                }
            }
            let _ = app.run_on_main_thread(move || native::cancel(nonce));
        });
        Ok(())
    }
    pub(crate) fn cancel(&self, app: &AppHandle, id: Option<Uuid>) {
        let removed = self.0.lock().ok().and_then(|mut slot| {
            if id.is_none() || slot.as_ref().is_some_and(|s| Some(s.id) == id) {
                slot.take().map(|s| s.nonce)
            } else {
                None
            }
        });
        if let Some(id) = removed {
            let _ = app.run_on_main_thread(move || native::cancel(id));
        }
    }
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use block2::RcBlock;
    use objc2::{rc::Retained, runtime::Bool};
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};
    use std::{cell::RefCell, collections::HashMap};
    // All native contexts are created and destroyed on the main thread.
    thread_local! { static CONTEXTS: RefCell<HashMap<Uuid, Retained<LAContext>>> = RefCell::new(HashMap::new()); }
    pub(super) fn begin(
        id: Uuid,
        reply: Box<dyn Fn(Result<(), String>) + Send + Sync>,
    ) -> Result<(), String> {
        let context = unsafe { LAContext::new() };
        unsafe {
            context
                .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
                .map_err(|_| "Touch ID 当前不可用，请使用 PIN 或主密码。")?;
            context.setLocalizedFallbackTitle(Some(&NSString::from_str("")));
            let block = RcBlock::new(move |success: Bool, _error: *mut NSError| {
                reply(if success.as_bool() {
                    Ok(())
                } else {
                    Err("Touch ID 验证未完成，请重试或使用 PIN／主密码。".into())
                });
            });
            CONTEXTS.with(|slot| {
                slot.borrow_mut().insert(id, context.clone());
            });
            context.evaluatePolicy_localizedReason_reply(
                LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
                &NSString::from_str("解锁 VaultMesh 浏览器插件"),
                &block,
            );
        }
        Ok(())
    }
    pub(super) fn cancel(id: Uuid) {
        CONTEXTS.with(|slot| {
            if let Some(context) = slot.borrow_mut().remove(&id) {
                unsafe {
                    context.invalidate();
                }
            }
        });
    }
}
#[cfg(not(target_os = "macos"))]
mod native {
    use super::*;
    pub(super) fn begin(
        _: Uuid,
        _: Box<dyn Fn(Result<(), String>) + Send + Sync>,
    ) -> Result<(), String> {
        Err("当前平台暂不支持 Touch ID。".into())
    }
    pub(super) fn cancel(_: Uuid) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    fn binding() -> Binding {
        Binding(
            PathBuf::from("/synthetic/vault"),
            "synthetic-credential".into(),
        )
    }
    #[test]
    fn ct_sec_002_credentials_must_still_belong_to_the_same_vault_and_record() {
        let expected = binding();
        let vault = expected.0.clone();
        assert!(expected.matches(&vault, Some((vault.clone(), expected.1.clone()))));
        assert!(!expected.matches(&vault, None)); // Disabled during the system prompt.
        assert!(!expected.matches(&vault, Some((vault.clone(), "replacement".into()))));
        assert!(!expected.matches(
            std::path::Path::new("/synthetic/other-vault"),
            Some((vault, expected.1.clone()))
        ));
    }
    #[test]
    fn ct_browser_001_authentication_requires_live_poll_and_is_single_use() {
        let state = Authentication::default();
        let now = Instant::now();
        let id = Uuid::new_v4();
        let nonce = state.register(id, binding(), now).unwrap();
        assert!(state.register(id, binding(), now).is_err());
        state.complete(Uuid::new_v4(), Ok(()));
        assert_eq!(state.poll(id, now).unwrap(), None);
        state.complete(nonce, Ok(()));
        assert_eq!(state.poll(id, now).unwrap(), Some(binding()));
        assert!(state.poll(id, now).is_err());
        state.complete(nonce, Ok(()));
        assert!(state.poll(id, now).is_err());
    }
    #[test]
    fn ct_sec_002_expiry_failure_and_replaced_sessions_do_not_authenticate() {
        for result in [Ok(()), Err("cancelled".into())] {
            let state = Authentication::default();
            let now = Instant::now();
            let id = Uuid::new_v4();
            let nonce = state.register(id, binding(), now).unwrap();
            state.complete(nonce, result);
            assert!(state.poll(id, now + LEASE).is_err());
            assert!(!state.alive(nonce, now + LEASE));
        }
        let state = Authentication::default();
        let now = Instant::now();
        let id = Uuid::new_v4();
        let nonce = state.register(id, binding(), now).unwrap();
        state.complete(nonce, Err("cancelled".into()));
        assert!(state.poll(id, now).is_err());
        let newer = id; // Reusing an external session ID cannot revive an older native callback.
        let newer_nonce = state.register(newer, binding(), now).unwrap();
        state.complete(nonce, Ok(()));
        assert_eq!(state.poll(newer, now).unwrap(), None);
        for second in 1..30 {
            assert_eq!(
                state
                    .poll(newer, now + Duration::from_secs(second))
                    .unwrap(),
                None
            );
        }
        state.complete(newer_nonce, Ok(()));
        assert!(state.poll(newer, now + LIFETIME).is_err());
    }
}
