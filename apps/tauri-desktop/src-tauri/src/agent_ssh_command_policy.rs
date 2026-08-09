use serde_json::Value;

use crate::agent_broker::AgentBrokerError;
use vaultmesh_ffi::AgentRiskTier;

pub(super) const SAFE_SSH_CATALOG_REVISION: &str = "ssh-safe-v1";
pub(super) const SAFE_SSH_PROGRAMS: &[&str] = &["hostname", "whoami", "uptime", "uname", "id"];

pub(super) fn validate_and_serialize(
    program: &str,
    arguments: &[String],
) -> Result<String, AgentBrokerError> {
    if program.is_empty()
        || program.len() > 128
        || program.contains("..")
        || !program
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b'/'))
        || arguments.len() > 64
        || arguments.iter().any(|argument| {
            argument.len() > 4_096
                || argument.contains('\0')
                || argument.chars().any(|character| character.is_control())
        })
    {
        return Err(AgentBrokerError::new(
            "invalid-ssh-command",
            "The structured SSH command is invalid.",
            false,
        ));
    }
    let mut tokens = Vec::with_capacity(arguments.len() + 1);
    tokens.push(program.to_owned());
    tokens.extend(arguments.iter().map(|argument| {
        if argument.is_empty() {
            "''".to_owned()
        } else {
            format!("'{}'", argument.replace('\'', "'\\''"))
        }
    }));
    Ok(tokens.join(" "))
}

pub(super) fn command_risk(parameters: &Value) -> Result<AgentRiskTier, AgentBrokerError> {
    let (program, arguments) = command_parts(parameters)?;
    validate_and_serialize(program, &arguments)?;
    let basename = program.rsplit('/').next().unwrap_or(program);
    let safe = match basename {
        "hostname" | "whoami" | "uptime" => arguments.is_empty(),
        "uname" => arguments
            .iter()
            .all(|argument| matches!(argument.as_str(), "-a" | "-s" | "-r" | "-m" | "-n")),
        "id" => arguments
            .iter()
            .all(|argument| matches!(argument.as_str(), "-u" | "-g" | "-G" | "-n")),
        _ => false,
    };
    Ok(if safe {
        AgentRiskTier::R1
    } else if matches!(basename, "sudo" | "su" | "doas") {
        AgentRiskTier::R3
    } else {
        AgentRiskTier::R2
    })
}

pub(super) fn command_display(parameters: &Value) -> Result<String, AgentBrokerError> {
    let (program, arguments) = command_parts(parameters)?;
    let display = validate_and_serialize(program, &arguments)?;
    if display.len() > 16_384 {
        return Err(AgentBrokerError::new(
            "invalid-ssh-command",
            "The structured SSH command is too long to authorize safely.",
            false,
        ));
    }
    Ok(display)
}

fn command_parts(parameters: &Value) -> Result<(&str, Vec<String>), AgentBrokerError> {
    let program = parameters
        .get("program")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AgentBrokerError::new("invalid-ssh-command", "An SSH program is required.", false)
        })?;
    let arguments = parameters
        .get("arguments")
        .and_then(Value::as_array)
        .map(|arguments| {
            arguments
                .iter()
                .map(|argument| {
                    argument.as_str().map(str::to_owned).ok_or_else(|| {
                        AgentBrokerError::new(
                            "invalid-ssh-command",
                            "The structured SSH arguments are invalid.",
                            false,
                        )
                    })
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?
        .unwrap_or_default();
    Ok((program, arguments))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ct_agent_ssh_safe_catalog_rejects_shell_and_classifies_structured_commands() {
        assert_eq!(
            command_risk(&json!({ "program": "hostname" })).unwrap(),
            AgentRiskTier::R1
        );
        assert_eq!(
            command_risk(&json!({ "program": "uname", "arguments": ["-a"] })).unwrap(),
            AgentRiskTier::R1
        );
        assert_eq!(
            command_risk(&json!({ "program": "rm", "arguments": ["-f", "/tmp/x"] })).unwrap(),
            AgentRiskTier::R2
        );
        assert_eq!(
            command_risk(&json!({ "program": "sudo" })).unwrap(),
            AgentRiskTier::R3
        );
        assert!(command_risk(&json!({ "program": "sh -c" })).is_err());
        assert!(command_risk(&json!({ "program": "hostname;id" })).is_err());
    }

    #[test]
    fn ct_agent_ssh_serializer_quotes_arguments_without_shell_expansion() {
        assert_eq!(
            validate_and_serialize("printf", &["%s".to_owned(), "a b'c".to_owned()]).unwrap(),
            "printf '%s' 'a b'\\''c'"
        );
        assert_eq!(SAFE_SSH_CATALOG_REVISION, "ssh-safe-v1");
        assert_eq!(
            command_display(&json!({ "program": "hostname" })).unwrap(),
            "hostname"
        );
    }
}
