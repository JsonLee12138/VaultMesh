use super::*;

pub(super) async fn handle_email(
    app: &AppHandle,
    state: &RuntimeState,
    operation: &str,
    input: Value,
) -> Result<Value, String> {
    if operation == "email.oauth.availability" {
        require_empty_object(&input)?;
        return Ok(EmailOtpService::oauth_availability());
    }
    if operation == "email.copy-code" {
        let code = email_otp_code(&input)?;
        let unlocked = with_runtime(state, |runtime| Ok(runtime.status().unlocked)).await?;
        if !unlocked {
            return Err("请先解锁保险库。".to_owned());
        }
        return copy_with_expiry(app, state, code);
    }
    if operation == "email.oauth.connect" {
        let dialog_guard = state.native_dialog_focus.begin();
        let prepared = tauri::async_runtime::spawn_blocking(move || {
            let _dialog_guard = dialog_guard;
            EmailOtpService::prepare_oauth(input, unix_millis() / 1000)
        })
        .await
        .map_err(|_| "OAuth 授权未能完成。".to_owned())??;
        let runtime = Arc::clone(&state.runtime);
        let service = Arc::clone(&state.email_otp);
        return tauri::async_runtime::spawn_blocking(move || {
            let mut runtime = runtime
                .lock()
                .map_err(|_| "保险库运行时暂时不可用。".to_owned())?;
            runtime
                .refresh_from_disk()
                .map_err(|error| error.public_message().to_owned())?;
            if !runtime.status().unlocked {
                return Err("保险库已锁定，OAuth 授权未保存。".to_owned());
            }
            service
                .lock()
                .map_err(|_| "邮箱服务暂时不可用。".to_owned())?
                .add_authorized_oauth(&mut runtime, prepared)
        })
        .await
        .map_err(|_| "OAuth 授权未能保存。".to_owned())?;
    }
    if operation == "email.scan" {
        require_empty_object(&input)?;
        let runtime = Arc::clone(&state.runtime);
        let service = Arc::clone(&state.email_otp);
        return tauri::async_runtime::spawn_blocking(move || {
            perform_email_scan(&runtime, &service, unix_millis() / 1000)
        })
        .await
        .map_err(|_| "邮箱操作未能完成。".to_owned())?;
    }
    let operation = operation.to_owned();
    let runtime = Arc::clone(&state.runtime);
    let service = Arc::clone(&state.email_otp);
    tauri::async_runtime::spawn_blocking(move || {
        let mut runtime = runtime
            .lock()
            .map_err(|_| "保险库运行时暂时不可用。".to_owned())?;
        runtime
            .refresh_from_disk()
            .map_err(|error| error.public_message().to_owned())?;
        if !runtime.status().unlocked {
            return Err("请先解锁保险库。".to_owned());
        }
        let mut service = service
            .lock()
            .map_err(|_| "邮箱服务暂时不可用。".to_owned())?;
        match operation.as_str() {
            "email.accounts" => service.accounts(&mut runtime),
            "email.accounts.add" => service.add_account(&mut runtime, input),
            "email.accounts.update" => service.update_account(&mut runtime, input),
            "email.accounts.delete" => service.delete_account(&mut runtime, input),
            "email.accounts.test" => {
                service.test_account(&mut runtime, input, unix_millis() / 1000)
            }
            "email.settings.get" => {
                require_empty_object(&input)?;
                Ok(service.settings())
            }
            "email.settings.update" => service.update_settings(input),
            _ => Err("该邮箱特权操作不被允许。".to_owned()),
        }
    })
    .await
    .map_err(|_| "邮箱操作未能完成。".to_owned())?
}

pub(super) fn perform_email_scan(
    runtime: &Arc<Mutex<DesktopRuntime>>,
    service: &Arc<Mutex<EmailOtpService>>,
    now: u64,
) -> Result<Value, String> {
    perform_email_scan_with(runtime, service, now, EmailOtpService::execute_scan)
}

pub(super) fn perform_email_scan_with<F>(
    runtime: &Arc<Mutex<DesktopRuntime>>,
    service: &Arc<Mutex<EmailOtpService>>,
    now: u64,
    execute: F,
) -> Result<Value, String>
where
    F: FnOnce(EmailScanPlan) -> EmailScanExecution,
{
    let plan = {
        let mut runtime = runtime
            .lock()
            .map_err(|_| "保险库运行时暂时不可用。".to_owned())?;
        runtime
            .refresh_from_disk()
            .map_err(|error| error.public_message().to_owned())?;
        if !runtime.status().unlocked {
            return Err("请先解锁保险库。".to_owned());
        }
        service
            .lock()
            .map_err(|_| "邮箱服务暂时不可用。".to_owned())?
            .begin_scan(&mut runtime, now)?
    };

    // Provider network I/O runs after both mutex guards above have been dropped.
    let execution = execute(plan);

    let finish = || -> Result<Value, String> {
        let mut runtime = runtime
            .lock()
            .map_err(|_| "保险库运行时暂时不可用。".to_owned())?;
        runtime
            .refresh_from_disk()
            .map_err(|error| error.public_message().to_owned())?;
        if !runtime.status().unlocked {
            return Err("保险库已锁定，邮箱扫描结果已丢弃。".to_owned());
        }
        service
            .lock()
            .map_err(|_| "邮箱服务暂时不可用。".to_owned())?
            .finish_scan(&mut runtime, execution)
    }();
    if finish.is_err()
        && let Ok(mut service) = service.lock()
    {
        service.abort_scan();
    }
    finish
}
