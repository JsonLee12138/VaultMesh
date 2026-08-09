use super::*;

pub(crate) fn normalize_card_number(value: &str) -> Result<String, VaultError> {
    let normalized: String = value
        .chars()
        .filter(|character| !matches!(character, ' ' | '-'))
        .collect();
    if !(12..=19).contains(&normalized.len())
        || !normalized.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(VaultError::InvalidCardNumber);
    }
    let sum: u32 = normalized
        .bytes()
        .rev()
        .enumerate()
        .map(|(index, byte)| {
            let mut digit = u32::from(byte - b'0');
            if index % 2 == 1 {
                digit *= 2;
                if digit > 9 {
                    digit -= 9;
                }
            }
            digit
        })
        .sum();
    if !sum.is_multiple_of(10) {
        return Err(VaultError::InvalidCardNumber);
    }
    Ok(normalized)
}

pub(crate) fn validate_card_fields(
    month: u8,
    year: u16,
    security_code: Option<&str>,
    pin: Option<&str>,
) -> Result<(), VaultError> {
    if !(1..=12).contains(&month) || !(1000..=9999).contains(&year) {
        return Err(VaultError::InvalidCardExpiration);
    }
    if security_code.is_some_and(|value| {
        !(3..=4).contains(&value.len()) || !value.bytes().all(|byte| byte.is_ascii_digit())
    }) {
        return Err(VaultError::InvalidCardSecurityCode);
    }
    if pin.is_some_and(|value| {
        !(4..=12).contains(&value.len()) || !value.bytes().all(|byte| byte.is_ascii_digit())
    }) {
        return Err(VaultError::InvalidCardPin);
    }
    Ok(())
}

pub(super) fn mask_card_number(value: &str) -> String {
    let last_four = value.get(value.len().saturating_sub(4)..).unwrap_or(value);
    format!("•••• {last_four}")
}

const MAX_SSH_KEY_BYTES: usize = 1024 * 1024;

pub(crate) fn validate_ssh_fields(
    title: &str,
    port: u16,
    _password: Option<&str>,
    public_key: Option<&str>,
    private_key: Option<&str>,
    key_passphrase: Option<&str>,
) -> Result<(), VaultError> {
    // An SSH account may intentionally have no stored authentication secret:
    // it can use a reusable key record, an SSH agent, or a one-time password.
    if title.trim().is_empty() || port == 0 {
        return Err(VaultError::InvalidSshCredential);
    }
    if let Some(key) = public_key {
        parse_public_key(key)?;
    }
    if let Some(key) = private_key
        && (key.len() > MAX_SSH_KEY_BYTES || !is_supported_private_key(key))
    {
        return Err(VaultError::InvalidSshPrivateKey);
    }
    if key_passphrase.is_some() && private_key.is_none() {
        return Err(VaultError::InvalidSshCredential);
    }
    Ok(())
}

pub(super) fn parse_public_key(value: &str) -> Result<(&str, Vec<u8>), VaultError> {
    if value.len() > MAX_SSH_KEY_BYTES {
        return Err(VaultError::InvalidSshPublicKey);
    }
    let mut parts = value.split_whitespace();
    let algorithm = parts.next().ok_or(VaultError::InvalidSshPublicKey)?;
    if !(algorithm.starts_with("ssh-")
        || algorithm.starts_with("ecdsa-sha2-")
        || algorithm.starts_with("sk-"))
    {
        return Err(VaultError::InvalidSshPublicKey);
    }
    let encoded = parts.next().ok_or(VaultError::InvalidSshPublicKey)?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| VaultError::InvalidSshPublicKey)?;
    if decoded.is_empty() {
        return Err(VaultError::InvalidSshPublicKey);
    }
    Ok((algorithm, decoded))
}

pub(super) fn public_key_metadata(value: Option<&str>) -> (Option<String>, Option<String>) {
    let Some(value) = value else {
        return (None, None);
    };
    match parse_public_key(value) {
        Ok((algorithm, decoded)) => {
            let digest = Sha256::digest(&decoded);
            (
                Some(algorithm.to_owned()),
                Some(format!("SHA256:{}", STANDARD_NO_PAD.encode(digest))),
            )
        }
        Err(_) => (None, None),
    }
}

pub(super) fn is_supported_private_key(value: &str) -> bool {
    let trimmed = value.trim();
    [
        "-----BEGIN OPENSSH PRIVATE KEY-----",
        "-----BEGIN RSA PRIVATE KEY-----",
        "-----BEGIN EC PRIVATE KEY-----",
        "-----BEGIN DSA PRIVATE KEY-----",
        "-----BEGIN PRIVATE KEY-----",
        "-----BEGIN ENCRYPTED PRIVATE KEY-----",
    ]
    .iter()
    .any(|header| trimmed.starts_with(header))
        && trimmed.contains("-----END ")
}
