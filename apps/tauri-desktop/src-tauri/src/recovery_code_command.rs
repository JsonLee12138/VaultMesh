use super::*;

pub(super) async fn import_recovery_code_file(
    app: &AppHandle,
    state: &RuntimeState,
) -> Result<Value, String> {
    let unlocked = with_runtime(state, |runtime| Ok(runtime.status().unlocked)).await?;
    if !unlocked {
        return Err("请先解锁保险库。".to_owned());
    }
    let app_for_dialog = app.clone();
    let dialog_guard = state.native_dialog_focus.begin();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _dialog_guard = dialog_guard;
        let selected = app_for_dialog
            .dialog()
            .file()
            .set_title("选择恢复码文件")
            .blocking_pick_file()
            .and_then(|path| path.into_path().ok());
        let Some(path) = selected else {
            return Ok(Value::Null);
        };
        let prepared = PreparedRecoveryCodeFile::load(path)?;
        let delete_confirmed = app_for_dialog
            .dialog()
            .message(format!(
                "已从“{}”解析 {} 个恢复码。\n\n是否删除原文件？删除不是安全擦除，不会清理其他副本或备份。",
                prepared.file_name(),
                prepared.code_count()
            ))
            .title("删除恢复码文件？")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "删除文件".into(),
                "保留文件".into(),
            ))
            .blocking_show();
        serde_json::to_value(prepared.finish(delete_confirmed))
            .map_err(|_| "无法返回恢复码文件结果。".to_owned())
    })
    .await
    .map_err(|_| "恢复码文件操作未能完成。".to_owned())??;
    let unlocked = with_runtime(state, |runtime| Ok(runtime.status().unlocked)).await?;
    if !unlocked {
        return Err("保险库已锁定，恢复码未返回到编辑器。".to_owned());
    }
    Ok(result)
}
