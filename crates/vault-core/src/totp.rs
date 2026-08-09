use hmac::{Hmac, Mac};
use sha1::Sha1;

use crate::VaultError;

pub const TOTP_PERIOD_SECONDS: u64 = 30;

/// A current one-time password and the number of seconds until it expires.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TotpCode {
    pub code: String,
    pub period: u32,
    pub remaining_seconds: u32,
}

/// Normalizes a Base32 seed or a default-profile `otpauth://totp` URI.
/// The stored form is unpadded uppercase RFC 4648 Base32.
pub fn normalize_totp_secret(input: &str) -> Result<String, VaultError> {
    let trimmed = input.trim();
    if trimmed
        .get(..10)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("otpauth://"))
    {
        normalize_uri(trimmed)
    } else {
        normalize_base32(trimmed)
    }
}

pub fn generate_totp(secret: &str, unix_time: u64) -> Result<TotpCode, VaultError> {
    let normalized = normalize_totp_secret(secret)?;
    let key = decode_base32(&normalized)?;
    let counter = unix_time / TOTP_PERIOD_SECONDS;
    let mut mac = Hmac::<Sha1>::new_from_slice(&key).map_err(|_| VaultError::InvalidTotpSecret)?;
    mac.update(&counter.to_be_bytes());
    let digest = mac.finalize().into_bytes();
    let offset = usize::from(digest[19] & 0x0f);
    let binary = (u32::from(digest[offset] & 0x7f) << 24)
        | (u32::from(digest[offset + 1]) << 16)
        | (u32::from(digest[offset + 2]) << 8)
        | u32::from(digest[offset + 3]);
    let code = format!("{:06}", binary % 1_000_000);
    Ok(TotpCode {
        code,
        period: TOTP_PERIOD_SECONDS as u32,
        remaining_seconds: (TOTP_PERIOD_SECONDS - unix_time % TOTP_PERIOD_SECONDS) as u32,
    })
}

fn normalize_uri(uri: &str) -> Result<String, VaultError> {
    let without_scheme = uri.get(10..).ok_or(VaultError::InvalidTotpSecret)?;
    let (kind, remainder) = without_scheme
        .split_once('/')
        .ok_or(VaultError::InvalidTotpSecret)?;
    if !kind.eq_ignore_ascii_case("totp") || remainder.is_empty() {
        return Err(VaultError::InvalidTotpSecret);
    }
    let (_, query) = remainder
        .split_once('?')
        .ok_or(VaultError::InvalidTotpSecret)?;
    let mut secret = None;
    for part in query.split('&') {
        let (raw_key, raw_value) = part.split_once('=').ok_or(VaultError::InvalidTotpSecret)?;
        let key = percent_decode(raw_key)?;
        let value = percent_decode(raw_value)?;
        match key.to_ascii_lowercase().as_str() {
            "secret" if secret.is_none() => secret = Some(value),
            "secret" => return Err(VaultError::InvalidTotpSecret),
            "algorithm" if value.eq_ignore_ascii_case("sha1") => {}
            "digits" if value == "6" => {}
            "period" if value == "30" => {}
            "issuer" => {}
            "algorithm" | "digits" | "period" => return Err(VaultError::InvalidTotpSecret),
            _ => {}
        }
    }
    normalize_base32(&secret.ok_or(VaultError::InvalidTotpSecret)?)
}

fn percent_decode(value: &str) -> Result<String, VaultError> {
    let mut bytes = Vec::with_capacity(value.len());
    let input = value.as_bytes();
    let mut index = 0;
    while index < input.len() {
        if input[index] == b'%' {
            if index + 2 >= input.len() {
                return Err(VaultError::InvalidTotpSecret);
            }
            let high = hex(input[index + 1])?;
            let low = hex(input[index + 2])?;
            bytes.push(high << 4 | low);
            index += 3;
        } else {
            bytes.push(if input[index] == b'+' {
                b' '
            } else {
                input[index]
            });
            index += 1;
        }
    }
    String::from_utf8(bytes).map_err(|_| VaultError::InvalidTotpSecret)
}

fn hex(value: u8) -> Result<u8, VaultError> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err(VaultError::InvalidTotpSecret),
    }
}

fn normalize_base32(input: &str) -> Result<String, VaultError> {
    let compact: String = input
        .chars()
        .filter(|value| !matches!(value, ' ' | '-'))
        .collect();
    let unpadded = compact.trim_end_matches('=');
    if unpadded.is_empty() || compact[unpadded.len()..].chars().any(|value| value != '=') {
        return Err(VaultError::InvalidTotpSecret);
    }
    let canonical = unpadded.to_ascii_uppercase();
    if !canonical
        .bytes()
        .all(|value| matches!(value, b'A'..=b'Z' | b'2'..=b'7'))
    {
        return Err(VaultError::InvalidTotpSecret);
    }
    let remainder = canonical.len() % 8;
    if !matches!(remainder, 0 | 2 | 4 | 5 | 7) {
        return Err(VaultError::InvalidTotpSecret);
    }
    if compact.len() != canonical.len() {
        let required = match remainder {
            0 => 0,
            2 => 6,
            4 => 4,
            5 => 3,
            7 => 1,
            _ => unreachable!(),
        };
        if compact.len() - canonical.len() != required {
            return Err(VaultError::InvalidTotpSecret);
        }
    }
    decode_base32(&canonical)?;
    Ok(canonical)
}

fn decode_base32(input: &str) -> Result<Vec<u8>, VaultError> {
    let mut output = Vec::with_capacity(input.len() * 5 / 8);
    let mut accumulator = 0_u32;
    let mut bits = 0_u8;
    for value in input.bytes() {
        let digit = match value {
            b'A'..=b'Z' => value - b'A',
            b'2'..=b'7' => value - b'2' + 26,
            _ => return Err(VaultError::InvalidTotpSecret),
        };
        accumulator = (accumulator << 5) | u32::from(digit);
        bits += 5;
        while bits >= 8 {
            bits -= 8;
            output.push((accumulator >> bits) as u8);
            accumulator &= (1 << bits) - 1;
        }
    }
    if bits > 0 && accumulator != 0 {
        return Err(VaultError::InvalidTotpSecret);
    }
    if output.is_empty() {
        return Err(VaultError::InvalidTotpSecret);
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_base32_and_uri() {
        assert_eq!(
            normalize_totp_secret(" jbsw-y3dp ehpk3pxp ").unwrap(),
            "JBSWY3DPEHPK3PXP"
        );
        assert_eq!(
            normalize_totp_secret(
                "otpauth://totp/Example:ada?secret=jbswy3dpehpk3pxp&issuer=Example"
            )
            .unwrap(),
            "JBSWY3DPEHPK3PXP"
        );
    }

    #[test]
    fn rejects_bad_or_unsupported_secrets() {
        for secret in [
            "",
            "ABC",
            "JBSWY3DP!",
            "otpauth://hotp/Example?secret=JBSWY3DP",
            "otpauth://totp/Example?secret=JBSWY3DP&digits=8",
        ] {
            assert_eq!(
                normalize_totp_secret(secret),
                Err(VaultError::InvalidTotpSecret)
            );
        }
    }

    #[test]
    fn generates_rfc_6238_six_digit_vectors() {
        let secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
        for (time, expected) in [
            (59, "287082"),
            (1_111_111_109, "081804"),
            (1_111_111_111, "050471"),
            (1_234_567_890, "005924"),
            (2_000_000_000, "279037"),
            (20_000_000_000, "353130"),
        ] {
            assert_eq!(generate_totp(secret, time).unwrap().code, expected);
        }
    }
}
