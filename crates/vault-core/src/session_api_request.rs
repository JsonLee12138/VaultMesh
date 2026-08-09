use super::*;
#[cfg(test)]
use crate::model::canonical_api_request_path;
use crate::{
    ApiCredentialField,
    model::{
        api_environment_refs_live, api_request_digest, credential_ref_live, normalize_api_request,
    },
};

impl VaultSession {
    pub fn prepare_api_request(
        &self,
        mut input: ApiRequestInput,
    ) -> Result<ApiRequestPlanSummary, VaultError> {
        let payload = self.payload()?;
        let environment = payload
            .api_environments
            .iter()
            .find(|environment| environment.id == input.environment_id)
            .ok_or(VaultError::ApiEnvironmentNotFound)?;
        if !payload
            .services
            .iter()
            .any(|service| service.id == environment.service_id)
            || !api_environment_refs_live(payload, environment)
        {
            input.zeroize();
            return Err(VaultError::ApiRequestPlanStale);
        }
        normalize_api_request(&mut input, environment)?;
        let request_digest = api_request_digest(&input, environment)?;
        let summary = ApiRequestPlanSummary {
            environment_id: environment.id,
            environment_revision: environment.revision,
            environment_policy_digest: environment.policy_digest.clone(),
            request_digest,
            method: input.method.clone(),
            origin: environment.origin.clone(),
            base_path: environment.base_path.clone(),
            path: input.path.clone(),
            body_type: input.body.kind_name().to_owned(),
            query_count: input.query.len() as u32,
            request_header_count: input.headers.len() as u32,
            fixed_header_count: environment.fixed_headers.len() as u32,
            auth_type: environment.auth.kind_name().to_owned(),
            mutation: !matches!(input.method.as_str(), "GET" | "HEAD"),
        };
        input.zeroize();
        Ok(summary)
    }

    pub fn compile_api_request(
        &self,
        mut input: ApiRequestInput,
        expected_environment_revision: u64,
        expected_environment_policy_digest: &str,
        expected_request_digest: &str,
    ) -> Result<ApiRequestExecutionPlan, VaultError> {
        let payload = self.payload()?;
        let environment = payload
            .api_environments
            .iter()
            .find(|environment| environment.id == input.environment_id)
            .ok_or(VaultError::ApiRequestPlanStale)?;
        if environment.revision != expected_environment_revision
            || environment.policy_digest != expected_environment_policy_digest
            || !payload
                .services
                .iter()
                .any(|service| service.id == environment.service_id)
            || !api_environment_refs_live(payload, environment)
        {
            input.zeroize();
            return Err(VaultError::ApiRequestPlanStale);
        }
        normalize_api_request(&mut input, environment)?;
        let request_digest = api_request_digest(&input, environment)?;
        if request_digest != expected_request_digest {
            input.zeroize();
            return Err(VaultError::ApiRequestPlanStale);
        }

        let summary = ApiRequestPlanSummary {
            environment_id: environment.id,
            environment_revision: environment.revision,
            environment_policy_digest: environment.policy_digest.clone(),
            request_digest,
            method: input.method.clone(),
            origin: environment.origin.clone(),
            base_path: environment.base_path.clone(),
            path: input.path.clone(),
            body_type: input.body.kind_name().to_owned(),
            query_count: input.query.len() as u32,
            request_header_count: input.headers.len() as u32,
            fixed_header_count: environment.fixed_headers.len() as u32,
            auth_type: environment.auth.kind_name().to_owned(),
            mutation: !matches!(input.method.as_str(), "GET" | "HEAD"),
        };

        let mut canaries = Vec::new();
        let authentication = match &environment.auth {
            ApiEnvironmentAuth::None => ApiRequestAuthenticationMaterial::None,
            ApiEnvironmentAuth::Bearer { credential } => {
                let token = resolve_api_credential(payload, credential)?;
                canaries.push(token.to_string());
                ApiRequestAuthenticationMaterial::Bearer { token }
            }
            ApiEnvironmentAuth::Basic { username, password } => {
                let username = resolve_api_credential(payload, username)?;
                let password = resolve_api_credential(payload, password)?;
                canaries.push(password.to_string());
                canaries.push(format!("{}:{}", username.as_str(), password.as_str()));
                ApiRequestAuthenticationMaterial::Basic { username, password }
            }
            ApiEnvironmentAuth::ApiKey {
                location,
                name,
                credential,
            } => {
                let value = resolve_api_credential(payload, credential)?;
                canaries.push(value.to_string());
                ApiRequestAuthenticationMaterial::ApiKey {
                    location: *location,
                    name: name.clone(),
                    value,
                }
            }
        };

        let mut headers = input
            .headers
            .iter()
            .map(|header| ApiRequestValueMaterial {
                name: header.name.clone(),
                value: Zeroizing::new(header.value.clone()),
            })
            .collect::<Vec<_>>();
        for header in &environment.fixed_headers {
            let value = match &header.source {
                ApiHeaderSource::Literal { value } => Zeroizing::new(value.clone()),
                ApiHeaderSource::Protected { credential } => {
                    let value = resolve_api_credential(payload, credential)?;
                    canaries.push(value.to_string());
                    value
                }
            };
            headers.push(ApiRequestValueMaterial {
                name: header.name.clone(),
                value,
            });
        }
        headers.sort_by(|left, right| left.name.cmp(&right.name));

        let query = input
            .query
            .iter()
            .map(|pair| ApiRequestValueMaterial {
                name: pair.name.clone(),
                value: Zeroizing::new(pair.value.clone()),
            })
            .collect();
        let body = std::mem::replace(&mut input.body, ApiRequestBodyInput::None);
        input.zeroize();
        Ok(ApiRequestExecutionPlan {
            summary,
            query,
            headers,
            body,
            authentication,
            canaries: Zeroizing::new(canaries),
        })
    }
}

fn resolve_api_credential(
    payload: &VaultPayload,
    reference: &ApiCredentialRef,
) -> Result<Zeroizing<String>, VaultError> {
    if !credential_ref_live(payload, reference) {
        return Err(VaultError::ApiRequestPlanStale);
    }
    let value = match (reference.item_kind, reference.field) {
        (ApiCredentialItemKind::Login, ApiCredentialField::LoginUsername) => payload
            .items
            .iter()
            .find(|item| item.id == reference.item_id)
            .map(|item| item.username.clone()),
        (ApiCredentialItemKind::Login, ApiCredentialField::LoginPassword) => payload
            .items
            .iter()
            .find(|item| item.id == reference.item_id)
            .map(|item| item.password.clone()),
        (ApiCredentialItemKind::Secret, ApiCredentialField::SecretValue) => payload
            .secrets
            .iter()
            .find(|item| item.id == reference.item_id)
            .map(|item| item.secret.clone()),
        _ => None,
    }
    .ok_or(VaultError::ApiRequestPlanStale)?;
    Ok(Zeroizing::new(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_request_path_rejects_escape_and_normalizes_percent_hex() {
        assert_eq!(
            canonical_api_request_path("/v1/%7euser").unwrap(),
            "/v1/%7Euser"
        );
        for invalid in [
            "v1/items",
            "//example.test/x",
            "/v1/../admin",
            "/v1/%2e%2e/admin",
            "/v1/%2fadmin",
            "/v1/a//b",
            "/v1/x?admin=true",
            "/v1/项目",
        ] {
            assert!(
                canonical_api_request_path(invalid).is_err(),
                "accepted {invalid}"
            );
        }
    }
}
