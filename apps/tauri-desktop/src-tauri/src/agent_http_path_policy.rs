use serde_json::Value;
use vaultmesh_ffi::AgentRiskTier;

use crate::agent_broker::AgentBrokerError;

pub(super) const HTTP_PATH_MATCHER_REVISION: &str = "http-path-v1";

pub(super) fn canonicalize_exact_path(path: &str) -> Result<String, AgentBrokerError> {
    if path.is_empty()
        || path.len() > 2_048
        || !path.starts_with('/')
        || path.starts_with("//")
        || !path.is_ascii()
        || path.contains(['\\', '?', '#', '*'])
        || path.chars().any(char::is_control)
    {
        return Err(invalid_path());
    }
    let bytes = path.as_bytes();
    let mut canonical = String::with_capacity(path.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            canonical.push(char::from(bytes[index]));
            index += 1;
            continue;
        }
        if index + 2 >= bytes.len() {
            return Err(invalid_path());
        }
        let high = hex_value(bytes[index + 1]).ok_or_else(invalid_path)?;
        let low = hex_value(bytes[index + 2]).ok_or_else(invalid_path)?;
        let decoded = high * 16 + low;
        if matches!(decoded, b'/' | b'\\' | b'.' | 0) || decoded.is_ascii_control() {
            return Err(invalid_path());
        }
        canonical.push('%');
        canonical.push(hex_upper(high));
        canonical.push(hex_upper(low));
        index += 3;
    }
    let segments = canonical.split('/').skip(1).collect::<Vec<_>>();
    if segments
        .iter()
        .any(|segment| segment.is_empty() || matches!(*segment, "." | ".."))
        && canonical != "/"
    {
        return Err(invalid_path());
    }
    Ok(canonical)
}

pub(super) fn join_base_path(
    base_path: &str,
    requested_path: &str,
) -> Result<String, AgentBrokerError> {
    let base = canonicalize_exact_path(if base_path.is_empty() { "/" } else { base_path })?;
    let requested = canonicalize_exact_path(requested_path)?;
    if base == "/" {
        return Ok(requested);
    }
    if requested == "/" {
        return Ok(base);
    }
    Ok(format!("{}{}", base.trim_end_matches('/'), requested))
}

pub(super) fn method_risk(method: &str) -> Result<AgentRiskTier, AgentBrokerError> {
    match method {
        "GET" | "HEAD" => Ok(AgentRiskTier::R1),
        "POST" => Ok(AgentRiskTier::R2),
        "PUT" | "PATCH" => Ok(AgentRiskTier::R3),
        "DELETE" => Ok(AgentRiskTier::R4),
        _ => Err(AgentBrokerError::new(
            "invalid-http-method",
            "The HTTP method is not supported.",
            false,
        )),
    }
}

pub(super) fn response_mode(parameters: &Value) -> Result<&str, AgentBrokerError> {
    match parameters
        .get("responseMode")
        .and_then(Value::as_str)
        .unwrap_or("status")
    {
        mode @ ("status" | "json") => Ok(mode),
        _ => Err(AgentBrokerError::new(
            "invalid-http-response-mode",
            "The HTTP response mode is invalid.",
            false,
        )),
    }
}

pub(super) fn validate_pattern(pattern: &str) -> Result<(), AgentBrokerError> {
    if pattern == "/" {
        return Ok(());
    }
    if pattern.is_empty()
        || pattern.len() > 2_048
        || !pattern.starts_with('/')
        || pattern.starts_with("//")
        || !pattern.is_ascii()
        || pattern.contains(['\\', '?', '#', '%', '{', '}'])
        || pattern.chars().any(char::is_control)
    {
        return Err(invalid_pattern());
    }
    let segments = pattern.split('/').skip(1).collect::<Vec<_>>();
    if segments.iter().any(|segment| {
        segment.is_empty()
            || matches!(*segment, "." | "..")
            || (segment.contains('*') && !matches!(*segment, "*" | "**"))
    }) {
        return Err(invalid_pattern());
    }
    if segments
        .iter()
        .enumerate()
        .any(|(index, segment)| *segment == "**" && index + 1 != segments.len())
    {
        return Err(invalid_pattern());
    }
    Ok(())
}

pub(super) fn path_matches(pattern: &str, path: &str) -> bool {
    if validate_pattern(pattern).is_err()
        || canonicalize_exact_path(path)
            .ok()
            .as_deref()
            .is_none_or(|canonical| canonical != path)
    {
        return false;
    }
    let pattern_segments = pattern.split('/').skip(1).collect::<Vec<_>>();
    let path_segments = path.split('/').skip(1).collect::<Vec<_>>();
    for (index, segment) in pattern_segments.iter().enumerate() {
        if *segment == "**" {
            return true;
        }
        let Some(candidate) = path_segments.get(index) else {
            return false;
        };
        if *segment != "*" && segment != candidate {
            return false;
        }
    }
    pattern_segments.len() == path_segments.len()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn hex_upper(value: u8) -> char {
    char::from(if value < 10 {
        b'0' + value
    } else {
        b'A' + value - 10
    })
}

fn invalid_path() -> AgentBrokerError {
    AgentBrokerError::new(
        "invalid-http-path",
        "The HTTP path is not canonical or escapes the approved base path.",
        false,
    )
}

fn invalid_pattern() -> AgentBrokerError {
    AgentBrokerError::new(
        "invalid-http-path-pattern",
        "The HTTP path permission pattern is invalid.",
        false,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ct_agent_http_path_001_canonicalizes_once_and_rejects_separator_or_dot_bypass() {
        assert_eq!(
            canonicalize_exact_path("/v1/projects/42").unwrap(),
            "/v1/projects/42"
        );
        assert_eq!(
            canonicalize_exact_path("/v1/%7euser").unwrap(),
            "/v1/%7Euser"
        );
        for invalid in [
            "v1/projects",
            "//evil.test/x",
            "/v1/../admin",
            "/v1/%2e%2e/admin",
            "/v1/%2Fadmin",
            "/v1/%5cadmin",
            "/v1/*",
            "/v1/a//b",
            "/v1/x?admin=true",
            "/v1/项目",
        ] {
            assert!(
                canonicalize_exact_path(invalid).is_err(),
                "accepted {invalid}"
            );
        }
        assert_eq!(
            join_base_path("/api/v1", "/projects").unwrap(),
            "/api/v1/projects"
        );
    }

    #[test]
    fn ct_agent_http_path_001_matches_only_segment_star_and_terminal_double_star() {
        assert!(path_matches("/api/projects/*", "/api/projects/42"));
        assert!(!path_matches("/api/projects/*", "/api/projects/42/members"));
        assert!(path_matches("/api/projects/**", "/api/projects/42/members"));
        assert!(path_matches("/api/projects/**", "/api/projects"));
        assert!(!path_matches("/api/*/admin", "/api/x/admin/extra"));
        for invalid in ["/api/foo*", "/api/**/admin", "/api/{id}", "/api/%2A"] {
            assert!(validate_pattern(invalid).is_err(), "accepted {invalid}");
        }
    }

    #[test]
    fn ct_agent_http_path_001_method_sets_risk_floor() {
        assert_eq!(method_risk("GET").unwrap(), AgentRiskTier::R1);
        assert_eq!(method_risk("POST").unwrap(), AgentRiskTier::R2);
        assert_eq!(method_risk("PATCH").unwrap(), AgentRiskTier::R3);
        assert_eq!(method_risk("DELETE").unwrap(), AgentRiskTier::R4);
        assert!(method_risk("OPTIONS").is_err());
    }
}
