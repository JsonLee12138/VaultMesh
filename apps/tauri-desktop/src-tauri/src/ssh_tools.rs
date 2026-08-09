use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use rand_core::OsRng;
use serde::{Deserialize, Serialize, ser::SerializeStruct};
use ssh_key::{
    Algorithm, EcdsaCurve, LineEnding, PrivateKey,
    private::{KeypairData, RsaKeypair},
};
use url::Url;
use zeroize::Zeroizing;

const MAX_COMMAND_BYTES: usize = 10_000;
const MAX_KEY_BYTES: usize = 1024 * 1024;

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshCommandImport {
    title: String,
    host: String,
    port: u16,
    username: String,
    notes: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum KeyAlgorithm {
    Ed25519,
    Ecdsa,
    Rsa,
    Mldsa,
}

impl KeyAlgorithm {
    fn as_str(self) -> &'static str {
        match self {
            Self::Ed25519 => "ed25519",
            Self::Ecdsa => "ecdsa",
            Self::Rsa => "rsa",
            Self::Mldsa => "mldsa",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum KeyStorage {
    ManagedDefault,
    ManagedNamed,
    VaultOnly,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeyGenerationInput {
    label: String,
    algorithm: KeyAlgorithm,
    #[serde(default)]
    key_size: Option<u16>,
    #[serde(default)]
    passphrase: Option<String>,
    #[serde(default)]
    save_passphrase: bool,
    #[serde(default = "default_storage")]
    storage: KeyStorage,
}

fn default_storage() -> KeyStorage {
    KeyStorage::ManagedDefault
}

#[derive(Debug)]
pub struct KeyGenerationResult {
    algorithm: &'static str,
    public_key: String,
    private_key: Zeroizing<String>,
    key_passphrase: Option<Zeroizing<String>>,
    private_key_path: Option<String>,
}

impl Serialize for KeyGenerationResult {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut state = serializer.serialize_struct("KeyGenerationResult", 5)?;
        state.serialize_field("algorithm", self.algorithm)?;
        state.serialize_field("publicKey", &self.public_key)?;
        state.serialize_field("privateKey", self.private_key.as_str())?;
        state.serialize_field(
            "keyPassphrase",
            &self.key_passphrase.as_ref().map(|value| value.as_str()),
        )?;
        state.serialize_field("privateKeyPath", &self.private_key_path)?;
        state.end()
    }
}

#[derive(Debug)]
struct ParsedOption {
    name: String,
    value: Option<String>,
    display: String,
}

pub fn parse_ssh_command(command: &str) -> Result<SshCommandImport, String> {
    if command.len() > MAX_COMMAND_BYTES {
        return Err("SSH 命令过长，无法导入。".to_owned());
    }
    let mut tokens = tokenize(command.trim())?;
    if tokens.is_empty() {
        return Err("剪贴板为空，请先复制一条 SSH 命令。".to_owned());
    }

    let executable = tokens.remove(0);
    let normalized = executable.replace('\\', "/");
    let executable_name = normalized
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .trim_end_matches(".exe")
        .to_ascii_lowercase();
    let is_url = executable.to_ascii_lowercase().starts_with("ssh://");
    if executable_name != "ssh" && !is_url {
        return Err("剪贴板内容不是 SSH 命令，请复制例如 ssh root@192.168.1.1。".to_owned());
    }
    if is_url {
        if !tokens.is_empty() {
            return Err("ssh:// 地址后不能包含额外的命令参数。".to_owned());
        }
        return parse_ssh_url(&executable);
    }

    let mut options = Vec::new();
    let mut destination = None;
    let mut remote_command = Vec::new();
    let mut options_ended = false;
    let mut index = 0;
    while index < tokens.len() {
        let token = &tokens[index];
        if !options_ended && token == "--" {
            options_ended = true;
            index += 1;
            continue;
        }
        if !options_ended && token.starts_with('-') && token != "-" {
            let (option, consumed) = read_option(token, tokens.get(index + 1))?;
            options.push(option);
            index += consumed;
            continue;
        }
        destination = Some(token.clone());
        remote_command.extend(tokens[index + 1..].iter().cloned());
        break;
    }

    let destination = destination.ok_or_else(|| "SSH 命令缺少目标主机。".to_owned())?;
    if destination.to_ascii_lowercase().starts_with("ssh://") {
        let mut imported = parse_ssh_url(&destination)?;
        imported.notes = build_notes(&options, &remote_command, &imported.notes);
        return validate_import(imported);
    }

    let (destination_username, destination_host) = parse_destination(&destination)?;
    let (config_user, config_host, config_port) = parse_config_options(&options);
    let username = if destination_username.is_empty() {
        last_option_value(&options, "l")
            .or(config_user)
            .unwrap_or_default()
    } else {
        destination_username
    };
    let host = config_host.unwrap_or(destination_host);
    let port = parse_port(last_option_value(&options, "p").or(config_port).as_deref())?;
    validate_import(SshCommandImport {
        title: if username.is_empty() {
            host.clone()
        } else {
            format!("{username}@{host}")
        },
        host,
        port,
        username,
        notes: build_notes(&options, &remote_command, ""),
    })
}

pub fn generate_key_pair(
    ssh_directory: &Path,
    input: KeyGenerationInput,
) -> Result<KeyGenerationResult, String> {
    validate_generation_input(&input)?;
    let KeyGenerationInput {
        label,
        algorithm,
        key_size,
        passphrase,
        save_passphrase,
        storage,
    } = input;
    let label = label.trim().to_owned();
    if algorithm == KeyAlgorithm::Mldsa {
        return Err("当前内置密钥引擎尚不支持 ML-DSA；请选择 ED25519、ECDSA 或 RSA。".to_owned());
    }

    let mut key = match algorithm {
        KeyAlgorithm::Ed25519 => PrivateKey::random(&mut OsRng, Algorithm::Ed25519),
        KeyAlgorithm::Ecdsa => PrivateKey::random(
            &mut OsRng,
            Algorithm::Ecdsa {
                curve: match key_size {
                    Some(256) => EcdsaCurve::NistP256,
                    Some(384) => EcdsaCurve::NistP384,
                    Some(521) => EcdsaCurve::NistP521,
                    _ => return Err("密钥长度与所选算法不匹配。".to_owned()),
                },
            },
        ),
        KeyAlgorithm::Rsa => {
            let pair = RsaKeypair::random(&mut OsRng, usize::from(key_size.unwrap_or_default()))
                .map_err(|_| "无法生成 RSA 密钥对。".to_owned())?;
            PrivateKey::new(KeypairData::from(pair), label.clone())
        }
        KeyAlgorithm::Mldsa => unreachable!(),
    }
    .map_err(|_| "无法生成 SSH 密钥对。".to_owned())?;
    key.set_comment(label.clone());

    let passphrase = passphrase.map(Zeroizing::new);
    let encoded_key = if let Some(secret) = passphrase.as_ref() {
        key.encrypt(&mut OsRng, secret.as_bytes())
            .and_then(|encrypted| encrypted.to_openssh(LineEnding::LF))
            .map_err(|_| "无法加密生成的 SSH 私钥。".to_owned())?
    } else {
        key.to_openssh(LineEnding::LF)
            .map_err(|_| "无法编码生成的 SSH 私钥。".to_owned())?
    };
    let public_key = key
        .public_key()
        .to_openssh()
        .map_err(|_| "无法编码生成的 SSH 公钥。".to_owned())?;
    if encoded_key.len() > MAX_KEY_BYTES || public_key.len() > MAX_KEY_BYTES {
        return Err("生成的 SSH 密钥超过允许大小。".to_owned());
    }

    let managed_root = ssh_directory.join("vaultmesh");
    let private_key_path = match storage {
        KeyStorage::VaultOnly => None,
        KeyStorage::ManagedDefault => Some(managed_root.join("id_ed25519")),
        KeyStorage::ManagedNamed => Some(
            managed_root
                .join("keys")
                .join(managed_filename(&label, algorithm)),
        ),
    };
    if let Some(path) = private_key_path.as_ref() {
        write_managed_key_pair(
            &managed_root,
            path,
            encoded_key.as_bytes(),
            public_key.as_bytes(),
        )?;
    }

    Ok(KeyGenerationResult {
        algorithm: algorithm.as_str(),
        public_key,
        private_key: encoded_key,
        key_passphrase: if save_passphrase { passphrase } else { None },
        private_key_path: private_key_path.map(|path| path.to_string_lossy().into_owned()),
    })
}

fn validate_generation_input(input: &KeyGenerationInput) -> Result<(), String> {
    let label = input.label.trim();
    if label.is_empty()
        || label.chars().count() > 256
        || label
            .chars()
            .any(|character| matches!(character, '\r' | '\n'))
    {
        return Err("SSH 密钥标签无效。".to_owned());
    }
    let size_valid = match input.algorithm {
        KeyAlgorithm::Ed25519 | KeyAlgorithm::Mldsa => input.key_size.is_none(),
        KeyAlgorithm::Ecdsa => matches!(input.key_size, Some(256 | 384 | 521)),
        KeyAlgorithm::Rsa => matches!(input.key_size, Some(2048 | 3072 | 4096)),
    };
    if !size_valid {
        return Err("密钥长度与所选算法不匹配。".to_owned());
    }
    if input
        .passphrase
        .as_ref()
        .is_some_and(|value| value.is_empty() || value.len() > 10_000)
    {
        return Err("SSH 私钥口令无效。".to_owned());
    }
    if input.save_passphrase && input.passphrase.is_none() {
        return Err("没有口令可供保存。".to_owned());
    }
    if input.storage == KeyStorage::ManagedDefault && input.algorithm != KeyAlgorithm::Ed25519 {
        return Err("本设备默认密钥必须使用 ED25519。".to_owned());
    }
    Ok(())
}

fn managed_filename(label: &str, algorithm: KeyAlgorithm) -> String {
    let mut slug = String::new();
    let mut separator = false;
    for character in label.chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
            slug.push(character.to_ascii_lowercase());
            separator = false;
        } else if !separator && !slug.is_empty() {
            slug.push('-');
            separator = true;
        }
        if slug.len() >= 64 {
            break;
        }
    }
    let slug = slug.trim_matches(['.', '-']).trim_end_matches('-');
    let slug = if slug.is_empty() { "ssh-key" } else { slug };
    format!("{slug}-{}", algorithm.as_str())
}

fn write_managed_key_pair(
    managed_root: &Path,
    private_path: &Path,
    private_key: &[u8],
    public_key: &[u8],
) -> Result<(), String> {
    let public_path = PathBuf::from(format!("{}.pub", private_path.to_string_lossy()));
    if private_path.exists() || public_path.exists() {
        return Err("目标 SSH 密钥已存在，VaultMesh 不会覆盖现有文件。".to_owned());
    }
    let parent = private_path
        .parent()
        .ok_or_else(|| "SSH 密钥目标路径无效。".to_owned())?;
    fs::create_dir_all(parent).map_err(|_| "无法创建受管 SSH 密钥目录。".to_owned())?;
    set_owner_only_directory(managed_root)?;
    set_owner_only_directory(parent)?;

    if let Err(error) = write_new_file(private_path, private_key, true) {
        let _ = fs::remove_file(private_path);
        return Err(error);
    }
    if let Err(error) = write_new_file(&public_path, public_key, false) {
        let _ = fs::remove_file(&public_path);
        let _ = fs::remove_file(private_path);
        return Err(error);
    }
    Ok(())
}

fn write_new_file(path: &Path, contents: &[u8], private: bool) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(if private { 0o600 } else { 0o644 });
    }
    #[cfg(not(unix))]
    let _ = private;
    let mut file = options
        .open(path)
        .map_err(|_| "无法安全创建 SSH 密钥文件。".to_owned())?;
    file.write_all(contents)
        .and_then(|_| file.write_all(b"\n"))
        .and_then(|_| file.sync_all())
        .map_err(|_| "无法安全写入 SSH 密钥文件。".to_owned())
}

fn set_owner_only_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "无法保护受管 SSH 密钥目录。".to_owned())?;
    }
    Ok(())
}

fn tokenize(input: &str) -> Result<Vec<String>, String> {
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut quote = None;
    let mut escaping = false;
    let mut started = false;
    for character in input.chars() {
        if escaping {
            token.push(character);
            escaping = false;
            started = true;
            continue;
        }
        if character == '\\' && quote != Some('\'') {
            escaping = true;
            started = true;
            continue;
        }
        if let Some(active_quote) = quote {
            if character == active_quote {
                quote = None;
            } else {
                token.push(character);
            }
            started = true;
            continue;
        }
        if matches!(character, '\'' | '"') {
            quote = Some(character);
            started = true;
            continue;
        }
        if character.is_whitespace() {
            if started {
                tokens.push(std::mem::take(&mut token));
                started = false;
            }
            continue;
        }
        token.push(character);
        started = true;
    }
    if escaping {
        return Err("SSH 命令末尾包含不完整的转义符。".to_owned());
    }
    if quote.is_some() {
        return Err("SSH 命令包含未闭合的引号。".to_owned());
    }
    if started {
        tokens.push(token);
    }
    Ok(tokens)
}

fn read_option(token: &str, next: Option<&String>) -> Result<(ParsedOption, usize), String> {
    if let Some(long) = token.strip_prefix("--") {
        let (name, value) = long
            .split_once('=')
            .map_or((long, None), |(name, value)| (name, Some(value.to_owned())));
        return Ok((
            ParsedOption {
                name: name.to_owned(),
                value,
                display: token.to_owned(),
            },
            1,
        ));
    }
    let name = token
        .chars()
        .nth(1)
        .ok_or_else(|| "SSH 参数无效。".to_owned())?;
    if !"BbcDEeFIiJLlmOoPpQRSWw".contains(name) {
        return Ok((
            ParsedOption {
                name: name.to_string(),
                value: None,
                display: token.to_owned(),
            },
            1,
        ));
    }
    let attached = &token[2..];
    let (value, consumed) = if attached.is_empty() {
        (
            next.cloned()
                .ok_or_else(|| format!("SSH 参数 -{name} 缺少值。"))?,
            2,
        )
    } else {
        (attached.to_owned(), 1)
    };
    let display = if attached.is_empty() {
        format!("{token} {}", shell_quote(&value))
    } else {
        token.to_owned()
    };
    Ok((
        ParsedOption {
            name: name.to_string(),
            value: Some(value),
            display,
        },
        consumed,
    ))
}

fn parse_destination(destination: &str) -> Result<(String, String), String> {
    let (username, host) = destination
        .rsplit_once('@')
        .map_or(("", destination), |(username, host)| (username, host));
    let host = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    if host.is_empty() || host.chars().any(char::is_whitespace) {
        return Err("SSH 命令中的目标主机无效。".to_owned());
    }
    Ok((username.to_owned(), host.to_owned()))
}

fn parse_ssh_url(value: &str) -> Result<SshCommandImport, String> {
    let url = Url::parse(value).map_err(|_| "剪贴板中的 ssh:// 地址无效。".to_owned())?;
    if url.scheme() != "ssh" || url.host_str().is_none() {
        return Err("剪贴板中的 ssh:// 地址无效。".to_owned());
    }
    if url.password().is_some() {
        return Err("不支持在 ssh:// 地址中导入密码，请在身份验证区域单独填写。".to_owned());
    }
    if !matches!(url.path(), "" | "/") || url.query().is_some() || url.fragment().is_some() {
        return Err("ssh:// 地址不能包含路径、查询参数或片段。".to_owned());
    }
    let username = percent_decode(url.username())?;
    let raw_host = url.host_str().unwrap_or_default();
    let host = raw_host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(raw_host)
        .to_owned();
    let port = url.port().unwrap_or(22);
    validate_import(SshCommandImport {
        title: if username.is_empty() {
            host.clone()
        } else {
            format!("{username}@{host}")
        },
        host,
        port,
        username,
        notes: String::new(),
    })
}

fn percent_decode(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = bytes
                .get(index + 1..index + 3)
                .ok_or_else(|| "剪贴板中的 ssh:// 地址无效。".to_owned())?;
            let text =
                std::str::from_utf8(hex).map_err(|_| "剪贴板中的 ssh:// 地址无效。".to_owned())?;
            decoded.push(
                u8::from_str_radix(text, 16)
                    .map_err(|_| "剪贴板中的 ssh:// 地址无效。".to_owned())?,
            );
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).map_err(|_| "剪贴板中的 ssh:// 地址无效。".to_owned())
}

fn parse_config_options(
    options: &[ParsedOption],
) -> (Option<String>, Option<String>, Option<String>) {
    let mut user = None;
    let mut hostname = None;
    let mut port = None;
    for option in options {
        if option.name != "o" {
            continue;
        }
        let Some(value) = option.value.as_deref() else {
            continue;
        };
        let split = value
            .split_once('=')
            .or_else(|| value.split_once(char::is_whitespace));
        let Some((key, value)) = split else {
            continue;
        };
        let value = value.trim().to_owned();
        match key.to_ascii_lowercase().as_str() {
            "user" => user = Some(value),
            "hostname" => hostname = Some(value),
            "port" => port = Some(value),
            _ => {}
        }
    }
    (user, hostname, port)
}

fn last_option_value(options: &[ParsedOption], name: &str) -> Option<String> {
    options
        .iter()
        .rev()
        .find(|option| option.name == name)
        .and_then(|option| option.value.clone())
}

fn parse_port(value: Option<&str>) -> Result<u16, String> {
    match value {
        None | Some("") => Ok(22),
        Some(value) if value.chars().all(|character| character.is_ascii_digit()) => value
            .parse::<u16>()
            .ok()
            .filter(|port| *port > 0)
            .ok_or_else(|| "SSH 端口必须是 1 到 65535 之间的数字。".to_owned()),
        Some(_) => Err("SSH 端口必须是 1 到 65535 之间的数字。".to_owned()),
    }
}

fn build_notes(options: &[ParsedOption], remote_command: &[String], existing: &str) -> String {
    let mut lines = Vec::new();
    if !existing.is_empty() {
        lines.push(existing.to_owned());
    }
    if !options.is_empty() {
        lines.push(format!(
            "SSH 参数：{}",
            options
                .iter()
                .map(|option| option.display.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        ));
    }
    if !remote_command.is_empty() {
        lines.push(format!(
            "远程命令：{}",
            remote_command
                .iter()
                .map(|value| shell_quote(value))
                .collect::<Vec<_>>()
                .join(" ")
        ));
    }
    lines.join("\n")
}

fn shell_quote(value: &str) -> String {
    if value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "_@%+=:,./~-".contains(character))
    {
        value.to_owned()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

fn validate_import(imported: SshCommandImport) -> Result<SshCommandImport, String> {
    if imported.title.len() > 256
        || imported.host.len() > 256
        || imported.username.len() > 2_048
        || imported.notes.len() > 10_000
    {
        return Err("SSH 命令中的主机、用户名或参数过长，无法导入。".to_owned());
    }
    Ok(imported)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ssh_command_without_evaluating_shell_syntax() {
        let imported = parse_ssh_command(
            "ssh -p 2202 -o Hostname=server.example -l admin alias 'printf hello'",
        )
        .expect("parse");
        assert_eq!(imported.host, "server.example");
        assert_eq!(imported.port, 2202);
        assert_eq!(imported.username, "admin");
        assert!(imported.notes.contains("远程命令：'printf hello'"));

        let literal = parse_ssh_command("ssh host '$(touch /tmp/never-run)'").expect("literal");
        assert!(literal.notes.contains("$(touch /tmp/never-run)"));
    }

    #[test]
    fn parses_ssh_url_and_rejects_password_or_extra_arguments() {
        let imported = parse_ssh_command("ssh://first%20last@[2001:db8::1]:2222").expect("url");
        assert_eq!(imported.username, "first last");
        assert_eq!(imported.host, "2001:db8::1");
        assert_eq!(imported.port, 2222);
        assert!(parse_ssh_command("ssh://user:secret@example.com").is_err());
        assert!(parse_ssh_command("ssh://example.com uname").is_err());
    }

    #[test]
    fn rejects_malformed_or_oversized_commands() {
        assert!(parse_ssh_command("").is_err());
        assert!(parse_ssh_command("curl example.com").is_err());
        assert!(parse_ssh_command("ssh 'unterminated").is_err());
        assert!(parse_ssh_command(&"x".repeat(MAX_COMMAND_BYTES + 1)).is_err());
        assert!(parse_ssh_command("ssh -p 0 host").is_err());
    }

    #[test]
    fn generates_encrypted_ed25519_key_without_external_process() {
        let root =
            std::env::temp_dir().join(format!("vaultmesh-ssh-tools-{}", uuid::Uuid::new_v4()));
        let result = generate_key_pair(
            &root,
            KeyGenerationInput {
                label: "Workstation".to_owned(),
                algorithm: KeyAlgorithm::Ed25519,
                key_size: None,
                passphrase: Some("correct horse battery staple".to_owned()),
                save_passphrase: true,
                storage: KeyStorage::ManagedDefault,
            },
        )
        .expect("generate");
        let path = result.private_key_path.as_deref().expect("path");
        assert!(Path::new(path).exists());
        assert!(PathBuf::from(format!("{path}.pub")).exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(path)
                    .expect("private metadata")
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(Path::new(path).parent().expect("managed root"))
                    .expect("directory metadata")
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        let parsed = PrivateKey::from_openssh(result.private_key.as_bytes()).expect("private key");
        assert!(parsed.is_encrypted());
        assert!(result.key_passphrase.is_some());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn never_overwrites_existing_managed_key() {
        let root =
            std::env::temp_dir().join(format!("vaultmesh-ssh-tools-{}", uuid::Uuid::new_v4()));
        let input = || KeyGenerationInput {
            label: "Default".to_owned(),
            algorithm: KeyAlgorithm::Ed25519,
            key_size: None,
            passphrase: None,
            save_passphrase: false,
            storage: KeyStorage::ManagedDefault,
        };
        generate_key_pair(&root, input()).expect("first generation");
        let error = generate_key_pair(&root, input()).expect_err("must not overwrite");
        assert!(error.contains("不会覆盖"));
        let _ = fs::remove_dir_all(root);
    }
}
