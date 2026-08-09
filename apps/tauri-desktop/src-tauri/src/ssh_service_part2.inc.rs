pub fn execute_agent_command(
    request: AgentSshExecRequest,
    cancellation: &AtomicBool,
) -> Result<serde_json::Value, String> {
    if cancellation.load(Ordering::Acquire) {
        return Err("SSH Agent 操作已取消。".to_owned());
    }
    let connection = connect(&request.target)?;
    if connection.fingerprint != request.expected_host_key_fingerprint {
        return Err("服务器主机密钥与已批准指纹不一致。".to_owned());
    }
    authenticate(
        &connection.session,
        &request.target.username,
        &request.authentication,
    )?;
    let canaries = authentication_canaries(&request.authentication);
    let mut channel = connection
        .session
        .channel_session()
        .map_err(|_| "无法打开 SSH 命令通道。".to_owned())?;
    channel
        .exec(&request.command)
        .map_err(|_| "服务器拒绝执行已批准的 SSH 命令。".to_owned())?;
    connection.session.set_blocking(false);
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut truncated = false;
    let deadline = Instant::now() + IO_TIMEOUT;
    while !channel.eof() && Instant::now() < deadline {
        if cancellation.load(Ordering::Acquire) {
            let _ =
                connection
                    .session
                    .disconnect(None, "VaultMesh Agent operation cancelled", None);
            return Err("SSH Agent 操作已取消。".to_owned());
        }
        let mut progressed = false;
        progressed |= read_bounded(
            &mut channel,
            &mut stdout,
            request.max_output_bytes,
            &mut truncated,
        )?;
        progressed |= read_bounded(
            &mut channel.stderr(),
            &mut stderr,
            request.max_output_bytes,
            &mut truncated,
        )?;
        if !progressed {
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    if !channel.eof() {
        let _ = connection
            .session
            .disconnect(None, "VaultMesh Agent timeout", None);
        return Err("SSH 命令超过执行时限。".to_owned());
    }
    connection.session.set_blocking(true);
    channel
        .wait_close()
        .map_err(|_| "无法确认 SSH 命令完成状态。".to_owned())?;
    let exit_status = channel
        .exit_status()
        .map_err(|_| "无法读取 SSH 命令退出状态。".to_owned())?;
    let _ = connection
        .session
        .disconnect(None, "VaultMesh Agent operation complete", None);

    let mut result = serde_json::Map::new();
    if request
        .allowed_fields
        .iter()
        .any(|field| field == "exit_status")
    {
        result.insert("exitStatus".into(), serde_json::json!(exit_status));
    }
    if request.allowed_fields.iter().any(|field| field == "stdout") {
        result.insert(
            "stdout".into(),
            serde_json::json!(redact_canaries(
                &String::from_utf8_lossy(&stdout),
                &canaries
            )),
        );
    }
    if request.allowed_fields.iter().any(|field| field == "stderr") {
        result.insert(
            "stderr".into(),
            serde_json::json!(redact_canaries(
                &String::from_utf8_lossy(&stderr),
                &canaries
            )),
        );
    }
    result.insert("truncated".into(), serde_json::json!(truncated));
    Ok(serde_json::Value::Object(result))
}

pub fn execute_agent_upload(
    request: AgentSshTransferRequest,
    bytes: &[u8],
    cancellation: &AtomicBool,
) -> Result<serde_json::Value, String> {
    if bytes.is_empty() || bytes.len() > MAX_AGENT_TRANSFER_BYTES {
        return Err("SSH upload 超出允许大小。".to_owned());
    }
    let connection = approved_connection(
        &request.target,
        &request.expected_host_key_fingerprint,
        &request.authentication,
        cancellation,
    )?;
    let sftp = connection
        .session
        .sftp()
        .map_err(|_| "无法打开 SSH SFTP 会话。".to_owned())?;
    let (destination, parent) =
        approved_upload_path(&sftp, &request.remote_path, &request.remote_path_prefixes)?;
    let temporary = parent.join(format!(
        ".vaultmesh-upload-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let upload = (|| {
        let mut file = sftp
            .open_mode(
                &temporary,
                OpenFlags::WRITE | OpenFlags::EXCLUSIVE,
                0o600,
                OpenType::File,
            )
            .map_err(|_| "无法创建 SSH upload 临时文件。".to_owned())?;
        for chunk in bytes.chunks(32 * 1024) {
            if cancellation.load(Ordering::Acquire) {
                return Err("SSH Agent 操作已取消。".to_owned());
            }
            file.write_all(chunk)
                .map_err(|_| "无法写入 SSH upload 数据。".to_owned())?;
        }
        file.flush()
            .map_err(|_| "无法提交 SSH upload 临时文件。".to_owned())?;
        file.close()
            .map_err(|_| "无法提交 SSH upload 临时文件。".to_owned())?;
        if cancellation.load(Ordering::Acquire) {
            return Err("SSH Agent 操作已取消。".to_owned());
        }
        sftp.rename(
            &temporary,
            &destination,
            Some(RenameFlags::ATOMIC | RenameFlags::OVERWRITE | RenameFlags::NATIVE),
        )
        .map_err(|_| "服务器不支持安全的原子 SSH upload。".to_owned())?;
        let committed = sftp
            .realpath(&destination)
            .map_err(|_| "无法重验 SSH upload 目标。".to_owned())?;
        if committed != destination {
            return Err("SSH upload 目标发生变化。".to_owned());
        }
        Ok(())
    })();
    if upload.is_err() {
        let _ = sftp.unlink(&temporary);
    }
    upload?;
    let _ = connection
        .session
        .disconnect(None, "VaultMesh Agent upload complete", None);
    Ok(serde_json::json!({
        "status": "uploaded",
        "bytes": bytes.len(),
        "sha256": format!("sha256:{:x}", Sha256::digest(bytes))
    }))
}

pub fn execute_agent_download(
    request: AgentSshTransferRequest,
    cancellation: &AtomicBool,
) -> Result<AgentSshDownload, String> {
    let connection = approved_connection(
        &request.target,
        &request.expected_host_key_fingerprint,
        &request.authentication,
        cancellation,
    )?;
    let sftp = connection
        .session
        .sftp()
        .map_err(|_| "无法打开 SSH SFTP 会话。".to_owned())?;
    let source =
        approved_existing_path(&sftp, &request.remote_path, &request.remote_path_prefixes)?;
    let source_metadata = sftp
        .lstat(Path::new(&request.remote_path))
        .map_err(|_| "SSH download 文件不可用。".to_owned())?;
    if !source_metadata.is_file()
        || source_metadata
            .size
            .is_none_or(|size| size == 0 || size > MAX_AGENT_TRANSFER_BYTES as u64)
    {
        return Err("SSH download 只允许有界普通文件。".to_owned());
    }
    let mut file = sftp
        .open(&source)
        .map_err(|_| "无法打开 SSH download 文件。".to_owned())?;
    let opened_metadata = file
        .stat()
        .map_err(|_| "无法重验 SSH download 文件。".to_owned())?;
    if !opened_metadata.is_file()
        || opened_metadata
            .size
            .is_none_or(|size| size == 0 || size > MAX_AGENT_TRANSFER_BYTES as u64)
    {
        return Err("SSH download 只允许有界普通文件。".to_owned());
    }
    let mut bytes = Zeroizing::new(Vec::with_capacity(
        opened_metadata.size.unwrap_or(0) as usize
    ));
    let mut buffer = [0_u8; 32 * 1024];
    loop {
        if cancellation.load(Ordering::Acquire) {
            return Err("SSH Agent 操作已取消。".to_owned());
        }
        let count = file
            .read(&mut buffer)
            .map_err(|_| "无法读取 SSH download 数据。".to_owned())?;
        if count == 0 {
            break;
        }
        if bytes.len().saturating_add(count) > MAX_AGENT_TRANSFER_BYTES {
            return Err("SSH download 超出允许大小。".to_owned());
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    file.close()
        .map_err(|_| "无法关闭 SSH download 文件。".to_owned())?;
    if bytes.is_empty()
        || sftp
            .realpath(Path::new(&request.remote_path))
            .map_err(|_| "无法重验 SSH download 目标。".to_owned())?
            != source
    {
        return Err("SSH download 目标发生变化。".to_owned());
    }
    let basename = source
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty() && name.len() <= 255)
        .unwrap_or("ssh-download.bin")
        .to_owned();
    let _ = connection
        .session
        .disconnect(None, "VaultMesh Agent download complete", None);
    Ok(AgentSshDownload { basename, bytes })
}

fn approved_connection(
    target: &SshTarget,
    expected_host_key_fingerprint: &str,
    authentication: &AuthenticationMaterial,
    cancellation: &AtomicBool,
) -> Result<SshConnection, String> {
    if cancellation.load(Ordering::Acquire) {
        return Err("SSH Agent 操作已取消。".to_owned());
    }
    let connection = connect(target)?;
    if connection.fingerprint != expected_host_key_fingerprint {
        return Err("服务器主机密钥与已批准指纹不一致。".to_owned());
    }
    authenticate(&connection.session, &target.username, authentication)?;
    if cancellation.load(Ordering::Acquire) {
        let _ = connection
            .session
            .disconnect(None, "VaultMesh Agent operation cancelled", None);
        return Err("SSH Agent 操作已取消。".to_owned());
    }
    Ok(connection)
}

fn approved_upload_path(
    sftp: &ssh2::Sftp,
    requested: &str,
    prefixes: &[String],
) -> Result<(PathBuf, PathBuf), String> {
    validate_requested_remote_path(requested, prefixes)?;
    let requested = Path::new(requested);
    let parent = requested
        .parent()
        .ok_or_else(|| "SSH upload 目标路径无效。".to_owned())?;
    let basename = requested
        .file_name()
        .ok_or_else(|| "SSH upload 目标路径无效。".to_owned())?;
    let canonical_parent = sftp
        .realpath(parent)
        .map_err(|_| "SSH upload 目标目录不可用。".to_owned())?;
    let destination = canonical_parent.join(basename);
    validate_canonical_remote_path(sftp, &destination, prefixes)?;
    Ok((destination, canonical_parent))
}

fn approved_existing_path(
    sftp: &ssh2::Sftp,
    requested: &str,
    prefixes: &[String],
) -> Result<PathBuf, String> {
    validate_requested_remote_path(requested, prefixes)?;
    let canonical = sftp
        .realpath(Path::new(requested))
        .map_err(|_| "SSH remote path 不可用。".to_owned())?;
    validate_canonical_remote_path(sftp, &canonical, prefixes)?;
    Ok(canonical)
}

fn validate_requested_remote_path(requested: &str, prefixes: &[String]) -> Result<(), String> {
    if !valid_remote_path(requested)
        || prefixes.is_empty()
        || !prefixes
            .iter()
            .any(|prefix| path_is_within(requested, prefix))
    {
        Err("SSH remote path 不在已批准范围内。".to_owned())
    } else {
        Ok(())
    }
}

fn validate_canonical_remote_path(
    sftp: &ssh2::Sftp,
    path: &Path,
    prefixes: &[String],
) -> Result<(), String> {
    let path = path
        .to_str()
        .ok_or_else(|| "SSH remote path 编码无效。".to_owned())?;
    let allowed = prefixes.iter().any(|prefix| {
        sftp.realpath(Path::new(prefix))
            .ok()
            .and_then(|canonical| canonical.to_str().map(str::to_owned))
            .is_some_and(|prefix| path_is_within(path, &prefix))
    });
    if allowed {
        Ok(())
    } else {
        Err("SSH remote path canonicalization 越出允许范围。".to_owned())
    }
}

fn path_is_within(path: &str, prefix: &str) -> bool {
    path == prefix
        || path
            .strip_prefix(prefix)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

fn valid_remote_path(path: &str) -> bool {
    path.starts_with('/')
        && path != "/"
        && path.len() <= 4_096
        && path.is_ascii()
        && !path.contains("//")
        && !path.contains('\\')
        && path
            .split('/')
            .skip(1)
            .all(|component| !component.is_empty() && component != "." && component != "..")
        && !path.chars().any(char::is_control)
}

fn read_bounded(
    reader: &mut impl Read,
    output: &mut Vec<u8>,
    maximum: usize,
    truncated: &mut bool,
) -> Result<bool, String> {
    let mut buffer = [0_u8; 8 * 1024];
    match reader.read(&mut buffer) {
        Ok(0) => Ok(false),
        Ok(count) => {
            let remaining = maximum.saturating_sub(output.len());
            output.extend_from_slice(&buffer[..count.min(remaining)]);
            *truncated |= count > remaining;
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => Ok(false),
        Err(_) => Err("无法读取 SSH 命令结果。".to_owned()),
    }
}

fn authentication_canaries(authentication: &AuthenticationMaterial) -> Vec<String> {
    let mut canaries = Vec::new();
    match authentication {
        AuthenticationMaterial::StoredPassword(password) => canaries.push(password.to_string()),
        AuthenticationMaterial::AuthenticationKey(key) => {
            canaries.push(key.private_key.to_string());
            if let Some(public_key) = &key.public_key {
                canaries.push(public_key.to_string());
            }
            if let Some(passphrase) = &key.passphrase {
                canaries.push(passphrase.to_string());
            }
        }
        AuthenticationMaterial::SshAgent => {}
    }
    canaries
}

fn redact_canaries(output: &str, canaries: &[String]) -> String {
    let mut redacted = output.to_owned();
    for canary in canaries.iter().filter(|canary| !canary.is_empty()) {
        let encoded = STANDARD.encode(canary.as_bytes());
        let hex = canary
            .as_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        for representation in [canary.as_str(), encoded.as_str(), hex.as_str()] {
            redacted = redacted.replace(representation, "[REDACTED]");
        }
    }
    redacted
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyLoginVerification {
    Verified,
    Unavailable,
    Failed,
}

pub fn inspect_host_key(target: SshTarget) -> Result<HostKeyPreview, String> {
    let connection = connect(&target)?;
    Ok(HostKeyPreview {
        endpoint: target.endpoint(),
        fingerprint: connection.fingerprint,
    })
}

pub fn install_public_key(
    request: PublicKeyInstallRequest,
) -> Result<PublicKeyInstallResult, String> {
    install_public_key_cancellable(request, &AtomicBool::new(false))
}

pub fn install_public_key_cancellable(
    request: PublicKeyInstallRequest,
    cancellation: &AtomicBool,
) -> Result<PublicKeyInstallResult, String> {
    if cancellation.load(Ordering::Acquire) {
        return Err("SSH 公钥安装已取消。".to_owned());
    }
    let connection = connect(&request.target)?;
    if connection.fingerprint != request.expected_host_key_fingerprint {
        return Err("服务器主机密钥已变化，已停止安装；请重新确认指纹。".to_owned());
    }
    authenticate(
        &connection.session,
        &request.target.username,
        &request.authentication,
    )?;
    if cancellation.load(Ordering::Acquire) {
        return Err("SSH 公钥安装已取消。".to_owned());
    }

    let mut channel = connection
        .session
        .channel_session()
        .map_err(|_| "无法打开 SSH 安装通道。".to_owned())?;
    channel
        .exec(INSTALL_PUBLIC_KEY_COMMAND)
        .map_err(|_| "服务器拒绝执行公钥安装操作。".to_owned())?;
    for chunk in request.public_key.as_bytes().chunks(8 * 1024) {
        if cancellation.load(Ordering::Acquire) {
            return Err("SSH 公钥安装已取消。".to_owned());
        }
        channel
            .write_all(chunk)
            .map_err(|_| "无法向服务器发送公钥。".to_owned())?;
    }
    channel
        .write_all(b"\n")
        .and_then(|()| channel.flush())
        .map_err(|_| "无法向服务器发送公钥。".to_owned())?;
    channel
        .send_eof()
        .and_then(|()| channel.wait_eof())
        .and_then(|()| channel.wait_close())
        .map_err(|_| "服务器未能完成公钥安装。".to_owned())?;
    let exit_status = channel
        .exit_status()
        .map_err(|_| "无法确认公钥安装结果。".to_owned())?;
    let status = match exit_status {
        0 => "installed",
        20 => "alreadyPresent",
        _ => return Err("服务器未能更新 authorized_keys。".to_owned()),
    };
    let _ = connection
        .session
        .disconnect(None, "VaultMesh operation complete", None);

    if cancellation.load(Ordering::Acquire) {
        return Err("SSH 公钥安装已取消。".to_owned());
    }

    let key_login_verification = match request.verification_key {
        Some(verification_key)
            if verify_key_login(
                &request.target,
                &request.expected_host_key_fingerprint,
                &verification_key,
            ) =>
        {
            KeyLoginVerification::Verified
        }
        Some(_) => KeyLoginVerification::Failed,
        None => KeyLoginVerification::Unavailable,
    };
    Ok(PublicKeyInstallResult {
        endpoint: request.target.endpoint(),
        fingerprint: request.expected_host_key_fingerprint,
        status,
        key_login_verified: key_login_verification == KeyLoginVerification::Verified,
        key_login_verification,
    })
}

struct SshConnection {
    session: Session,
    fingerprint: String,
}

fn connect(target: &SshTarget) -> Result<SshConnection, String> {
    let addresses = (target.host.as_str(), target.port)
        .to_socket_addrs()
        .map_err(|_| "无法解析 SSH 主机。".to_owned())?
        .take(MAX_RESOLVED_ADDRESSES)
        .collect::<Vec<_>>();
    if addresses.is_empty() {
        return Err("无法解析 SSH 主机。".to_owned());
    }
    let mut last_error = None;
    for address in addresses {
        match TcpStream::connect_timeout(&address, CONNECT_TIMEOUT) {
            Ok(stream) => {
                stream
                    .set_read_timeout(Some(IO_TIMEOUT))
                    .map_err(|_| "无法设置 SSH 读取超时。".to_owned())?;
                stream
                    .set_write_timeout(Some(IO_TIMEOUT))
                    .map_err(|_| "无法设置 SSH 写入超时。".to_owned())?;
                let mut session = Session::new().map_err(|_| "无法初始化 SSH 会话。".to_owned())?;
                session.set_timeout(IO_TIMEOUT.as_millis() as u32);
                session.set_tcp_stream(stream);
                session
                    .handshake()
                    .map_err(|_| "SSH 握手失败。".to_owned())?;
                let fingerprint = session
                    .host_key()
                    .map(|(key, _)| fingerprint(key))
                    .ok_or_else(|| "服务器没有提供主机密钥。".to_owned())?;
                return Ok(SshConnection {
                    session,
                    fingerprint,
                });
            }
            Err(error) => last_error = Some(error),
        }
    }
    let _ = last_error;
    Err("无法连接 SSH 服务器。".to_owned())
}

fn authenticate(
    session: &Session,
    username: &str,
    material: &AuthenticationMaterial,
) -> Result<(), String> {
    match material {
        AuthenticationMaterial::StoredPassword(password) => session
            .userauth_password(username, password.as_str())
            .map_err(|_| "SSH 密码认证失败。".to_owned())?,
        AuthenticationMaterial::SshAgent => {
            let mut agent = session
                .agent()
                .map_err(|_| "无法访问 SSH Agent。".to_owned())?;
            agent
                .connect()
                .and_then(|()| agent.list_identities())
                .map_err(|_| "无法读取 SSH Agent 身份。".to_owned())?;
            let identities = agent
                .identities()
                .map_err(|_| "无法读取 SSH Agent 身份。".to_owned())?;
            let authenticated = identities
                .iter()
                .any(|identity| agent.userauth(username, identity).is_ok());
            if !authenticated {
                return Err("SSH Agent 中没有可用于该服务器的身份。".to_owned());
            }
        }
        AuthenticationMaterial::AuthenticationKey(key) => authenticate_key(session, username, key)
            .map_err(|_| "SSH 私钥认证失败；请检查私钥和口令。".to_owned())?,
    }
    if !session.authenticated() {
        return Err("SSH 认证失败。".to_owned());
    }
    Ok(())
}

fn authenticate_key(
    session: &Session,
    username: &str,
    key: &PrivateKeyMaterial,
) -> Result<(), ssh2::Error> {
    session.userauth_pubkey_memory(
        username,
        key.public_key.as_deref().map(String::as_str),
        key.private_key.as_str(),
        key.passphrase.as_deref().map(String::as_str),
    )
}

pub(super) fn verify_key_login(
    target: &SshTarget,
    expected_fingerprint: &str,
    key: &PrivateKeyMaterial,
) -> bool {
    let Ok(connection) = connect(target) else {
        return false;
    };
    connection.fingerprint == expected_fingerprint
        && authenticate_key(&connection.session, &target.username, key).is_ok()
        && connection.session.authenticated()
}

fn fingerprint(host_key: &[u8]) -> String {
    let digest = STANDARD.encode(Sha256::digest(host_key));
    format!("SHA256:{}", digest.trim_end_matches('='))
}

#[cfg(test)]
#[path = "ssh_service_tests.rs"]
mod tests;
