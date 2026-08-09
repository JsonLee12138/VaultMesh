use super::*;

pub(super) async fn handle_import(
    app: &AppHandle,
    state: &RuntimeState,
    operation: ImportOperation,
    input: Value,
) -> Result<Value, String> {
    let unlocked = with_runtime(state, |runtime| Ok(runtime.status().unlocked)).await?;
    if !unlocked {
        return Err("请先解锁保险库。".into());
    }
    match operation {
        ImportOperation::Select => {
            select_import(app, state, required_string(&input, "source")?).await
        }
        ImportOperation::Commit => {
            let session_id = required_string(&input, "sessionId")?;
            let payload = state
                .imports
                .lock()
                .map_err(|_| "导入状态暂时不可用。".to_owned())?
                .take_payload(&session_id, unix_millis())?;
            with_runtime(state, move |runtime| {
                runtime.execute("_native.import.batch", payload)
            })
            .await
        }
        ImportOperation::Cancel => {
            let session_id = required_string(&input, "sessionId")?;
            state
                .imports
                .lock()
                .map_err(|_| "导入状态暂时不可用。".to_owned())?
                .cancel(&session_id, unix_millis())?;
            Ok(json!({}))
        }
    }
}

pub(super) async fn select_import(
    app: &AppHandle,
    state: &RuntimeState,
    source: String,
) -> Result<Value, String> {
    validate_source(&source)?;
    let app_for_dialog = app.clone();
    let dialog_guard = state.native_dialog_focus.begin();
    let bitwarden = source == "bitwarden";
    let selected = tauri::async_runtime::spawn_blocking(move || {
        let _dialog_guard = dialog_guard;
        let builder = app_for_dialog.dialog().file().set_title("选择密码导出文件");
        let builder = if bitwarden {
            builder.add_filter("Bitwarden 导出文件", &["csv", "json"])
        } else {
            builder.add_filter("CSV 文件", &["csv"])
        };
        builder
            .blocking_pick_file()
            .and_then(|path| path.into_path().ok())
    })
    .await
    .map_err(|_| "导入文件对话框未能完成。".to_owned())?;
    let Some(path) = selected else {
        return Ok(Value::Null);
    };

    let imports = Arc::clone(&state.imports);
    let runtime = Arc::clone(&state.runtime);
    tauri::async_runtime::spawn_blocking(move || {
        let metadata = std::fs::metadata(&path).map_err(|_| "无法读取导入文件。".to_owned())?;
        validate_import_file(metadata.is_file(), metadata.len())?;
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .ok_or_else(|| "导入文件名称无效。".to_owned())?
            .to_owned();
        let bytes =
            Zeroizing::new(std::fs::read(&path).map_err(|_| "无法读取导入文件。".to_owned())?);
        if bytes.len() as u64 > MAX_IMPORT_FILE_BYTES {
            return Err("导出文件必须是小于 10 MB 的普通文件。".to_owned());
        }
        let contents = std::str::from_utf8(bytes.as_slice())
            .map_err(|_| "导入文件必须使用 UTF-8 编码。".to_owned())?;
        let runtime = runtime
            .lock()
            .map_err(|_| "保险库运行时暂时不可用。".to_owned())?;
        if !runtime.status().unlocked {
            return Err("请先解锁保险库。".to_owned());
        }
        imports
            .lock()
            .map_err(|_| "导入状态暂时不可用。".to_owned())?
            .prepare(
                &source,
                file_name,
                Zeroizing::new(contents.to_owned()),
                unix_millis(),
            )
    })
    .await
    .map_err(|_| "导入文件处理未能完成。".to_owned())?
}

pub(super) fn validate_import_file(is_file: bool, size: u64) -> Result<(), String> {
    if !is_file || size > MAX_IMPORT_FILE_BYTES {
        Err("导出文件必须是小于 10 MB 的普通文件。".to_owned())
    } else {
        Ok(())
    }
}

pub(super) fn clear_imports(state: &RuntimeState) {
    if let Ok(mut imports) = state.imports.lock() {
        imports.clear();
    }
}

pub(super) fn clear_privileged_sessions(state: &RuntimeState) {
    if let Ok(mut scan) = state.ssh_scan.lock() {
        scan.clear();
    }
    if let Ok(mut email) = state.email_otp.lock() {
        email.clear_runtime_state();
    }
    ssh_external::clear_launches(&state.ssh_launch_directory);
}
