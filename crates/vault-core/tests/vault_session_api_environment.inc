fn api_secret(kind: SecretItemKind, title: &str, value: &str) -> NewSecretItem {
    NewSecretItem {
        title: title.into(), kind, provider: None, account: None, secret: value.into(),
        environment: None, scopes: Vec::new(), expires_at: None, website: None, notes: None,
        folder: None, favorite: false, master_password_reprompt: false,
    }
}

fn secret_api_ref(id: Uuid, kind: SecretItemKind) -> ApiCredentialRef {
    ApiCredentialRef {
        item_kind: ApiCredentialItemKind::Secret,
        item_id: id,
        field: ApiCredentialField::SecretValue,
        expected_secret_kind: Some(kind),
    }
}

fn api_environment_input(service_id: Uuid, credential_id: Uuid) -> NewApiEnvironment {
    NewApiEnvironment {
        service_id,
        name: "Production".into(),
        kind: ApiEnvironmentKind::Production,
        origin: "https://api.example.test".into(),
        base_path: Some("/v1/".into()),
        openapi_url: Some("https://docs.example.test/openapi.json".into()),
        auth: ApiEnvironmentAuth::Bearer {
            credential: secret_api_ref(credential_id, SecretItemKind::AccessToken),
        },
        fixed_headers: vec![ApiFixedHeader {
            name: "X-API-Version".into(),
            source: ApiHeaderSource::Literal { value: "2026-08".into() },
        }],
    }
}

#[test]
fn api_environment_crud_round_trip_and_discovery_are_fail_closed() {
    let mut session = VaultSession::create("correct horse battery staple").unwrap();
    let service = session.add_service(new_service("Example", "https://example.test")).unwrap();
    let credential = session.add_secret(api_secret(
        SecretItemKind::AccessToken, "Production token", "credential-canary-never-render",
    )).unwrap();
    let created = session.add_api_environment(api_environment_input(service.id, credential.id)).unwrap();
    assert_eq!(created.revision, 1);
    assert_eq!(created.auth_kind, "bearer");
    let detail = session.api_environment_detail(created.id).unwrap();
    assert_eq!(detail.origin, "https://api.example.test");
    assert_eq!(detail.base_path.as_deref(), Some("/v1"));
    assert_eq!(detail.fixed_headers[0].name, "x-api-version");
    assert!(!serde_json::to_string(&detail).unwrap().contains("credential-canary-never-render"));

    let discovered = session.agent_api_environments().unwrap();
    assert_eq!(discovered.len(), 1);
    assert_eq!(discovered[0].environment_ref, created.id);
    let safe_json = serde_json::to_string(&discovered).unwrap();
    for forbidden in ["api.example.test", "x-api-version", "bearer", "credential_id", "credential-canary-never-render"] {
        assert!(!safe_json.contains(forbidden));
    }
    assert!(safe_json.contains("docs.example.test/openapi.json"));

    let mut exact_openapi = api_environment_input(service.id, credential.id);
    exact_openapi.name = "Exact OpenAPI".into();
    exact_openapi.openapi_url = Some("https://docs.example.test:443/openapi.json?format=yaml#schema".into());
    let exact = session.add_api_environment(exact_openapi).unwrap();
    assert_eq!(
        session.api_environment_detail(exact.id).unwrap().openapi_url.as_deref(),
        Some("https://docs.example.test:443/openapi.json?format=yaml#schema")
    );
    assert_eq!(session.agent_api_environments().unwrap().len(), 2);

    let unchanged = session.update_api_environment(ApiEnvironmentUpdate {
        id: created.id, input: api_environment_input(service.id, credential.id),
    }).unwrap();
    assert_eq!(unchanged.revision, 1);
    let mut changed_input = api_environment_input(service.id, credential.id);
    changed_input.origin = "https://staging.example.test".into();
    let changed = session.update_api_environment(ApiEnvironmentUpdate { id: created.id, input: changed_input }).unwrap();
    assert_eq!(changed.revision, 2);
    assert_ne!(changed.policy_digest, created.policy_digest);
    assert_eq!(session.api_environment_history(created.id).unwrap().len(), 1);

    let encrypted = session.save().unwrap();
    assert!(!String::from_utf8_lossy(&encrypted).contains("credential-canary-never-render"));
    let mut reopened = VaultSession::unlock("correct horse battery staple", &encrypted).unwrap();
    assert_eq!(reopened.agent_api_environments().unwrap().len(), 2);
    reopened.delete_api_environment(created.id).unwrap();
    assert_eq!(reopened.agent_api_environments().unwrap().len(), 1);
    let trash = reopened.list_api_environment_trash(service.id).unwrap();
    reopened.restore_api_environment_trash(trash[0].trash_id).unwrap();
    assert_eq!(reopened.agent_api_environments().unwrap().len(), 2);
}

#[test]
fn legacy_agent_enabled_field_is_ignored_and_dropped_without_gating_discovery() {
    let mut session = VaultSession::create("correct horse battery staple").unwrap();
    let service = session
        .add_service(new_service("Example", "https://example.test"))
        .unwrap();
    let credential = session
        .add_secret(api_secret(
            SecretItemKind::AccessToken,
            "Production token",
            "legacy-field-canary",
        ))
        .unwrap();
    session
        .add_api_environment(api_environment_input(service.id, credential.id))
        .unwrap();

    let mut legacy_json = serde_json::to_value(session.payload_snapshot().unwrap()).unwrap();
    legacy_json["api_environments"][0]
        .as_object_mut()
        .unwrap()
        .insert("agent_enabled".into(), serde_json::Value::Bool(false));
    let legacy_payload: VaultPayload = serde_json::from_value(legacy_json).unwrap();
    session.restore_payload_snapshot(legacy_payload).unwrap();

    assert_eq!(session.agent_api_environments().unwrap().len(), 1);
    let current_json = serde_json::to_string(&session.payload_snapshot().unwrap()).unwrap();
    assert!(!current_json.contains("agent_enabled"));

    let encrypted = session.save().unwrap();
    let reopened = VaultSession::unlock("correct horse battery staple", &encrypted).unwrap();
    assert_eq!(reopened.agent_api_environments().unwrap().len(), 1);
}

#[test]
fn api_environment_rejects_ambiguous_targets_reserved_headers_and_reference_drift() {
    let mut session = VaultSession::create("correct horse battery staple").unwrap();
    let service = session.add_service(new_service("Example", "https://example.test")).unwrap();
    let token = session.add_secret(api_secret(SecretItemKind::AccessToken, "Token", "token-value")).unwrap();
    for origin in ["https://user@example.test", "//example.test", "https://example.test/path", "https://example.test/%2e%2e/admin", "javascript:alert(1)"] {
        let mut input = api_environment_input(service.id, token.id); input.origin = origin.into();
        assert_eq!(session.add_api_environment(input), Err(VaultError::InvalidApiEnvironment), "origin {origin}");
    }
    for base_path in ["../admin", "/v1/%2fadmin", "//evil", "/v1/../admin"] {
        let mut input = api_environment_input(service.id, token.id); input.base_path = Some(base_path.into());
        assert_eq!(session.add_api_environment(input), Err(VaultError::InvalidApiEnvironment), "base path {base_path}");
    }
    for (field, value) in [
        ("origin", format!("https://{}.example.test", "a".repeat(2_048))),
        ("base-path", format!("/{}", "a".repeat(2_048))),
        ("openapi-url", format!("https://example.test/{}", "a".repeat(2_048))),
    ] {
        let mut input = api_environment_input(service.id, token.id);
        match field {
            "origin" => input.origin = value,
            "base-path" => input.base_path = Some(value),
            "openapi-url" => input.openapi_url = Some(value),
            _ => unreachable!(),
        }
        assert_eq!(session.add_api_environment(input), Err(VaultError::InvalidApiEnvironment));
    }
    for (name, value) in [("Authorization", "ordinary"), ("Cookie", "ordinary"), ("X-API-Key", "secret-literal"), ("X-Trace", "Bearer token")] {
        let mut input = api_environment_input(service.id, token.id);
        input.fixed_headers = vec![ApiFixedHeader { name: name.into(), source: ApiHeaderSource::Literal { value: value.into() } }];
        assert_eq!(session.add_api_environment(input), Err(VaultError::InvalidApiEnvironment));
    }
    let mut wrong_kind = api_environment_input(service.id, token.id);
    wrong_kind.auth = ApiEnvironmentAuth::ApiKey {
        location: ApiKeyLocation::Header, name: "X-API-Key".into(),
        credential: secret_api_ref(token.id, SecretItemKind::ApiKey),
    };
    assert_eq!(session.add_api_environment(wrong_kind), Err(VaultError::InvalidApiEnvironment));

    let api_key = session.add_secret(api_secret(SecretItemKind::ApiKey, "API key", "api-key-value")).unwrap();
    for (location, name) in [
        (ApiKeyLocation::Header, "Authorization"),
        (ApiKeyLocation::Header, "bad header"),
        (ApiKeyLocation::Query, "bad&query"),
    ] {
        let mut input = api_environment_input(service.id, token.id);
        input.auth = ApiEnvironmentAuth::ApiKey {
            location, name: name.into(), credential: secret_api_ref(api_key.id, SecretItemKind::ApiKey),
        };
        assert_eq!(session.add_api_environment(input), Err(VaultError::InvalidApiEnvironment));
    }
    let mut conflicting_header = api_environment_input(service.id, token.id);
    conflicting_header.auth = ApiEnvironmentAuth::ApiKey {
        location: ApiKeyLocation::Header, name: "X-API-Version".into(),
        credential: secret_api_ref(api_key.id, SecretItemKind::ApiKey),
    };
    assert_eq!(session.add_api_environment(conflicting_header), Err(VaultError::InvalidApiEnvironment));

    let created = session.add_api_environment(api_environment_input(service.id, token.id)).unwrap();
    session.delete_secret(token.id).unwrap();
    assert!(session.agent_api_environments().unwrap().is_empty());
    assert!(session.list_api_environments(service.id).unwrap()[0].revision > created.revision);
    session.delete_service(service.id).unwrap();
    assert_eq!(session.api_environment_detail(created.id), Err(VaultError::ServiceNotFound));
}

#[test]
fn api_request_plan_is_canonical_live_and_keeps_credentials_out_of_summary() {
    let mut session = VaultSession::create("correct horse battery staple").unwrap();
    let service = session.add_service(new_service("Example", "https://example.test")).unwrap();
    let token = session.add_secret(api_secret(
        SecretItemKind::AccessToken, "Token", "desktop-request-token-canary",
    )).unwrap();
    let protected = session.add_secret(api_secret(
        SecretItemKind::ClientSecret, "Protected header", "protected-header-canary",
    )).unwrap();
    let mut environment = api_environment_input(service.id, token.id);
    environment.fixed_headers.push(ApiFixedHeader {
        name: "X-Protected".into(),
        source: ApiHeaderSource::Protected {
            credential: secret_api_ref(protected.id, SecretItemKind::ClientSecret),
        },
    });
    let created = session.add_api_environment(environment).unwrap();
    let request = ApiRequestInput {
        environment_id: created.id,
        method: "POST".into(),
        path: "/users/%7eada".into(),
        query: vec![ApiRequestPair { name: "page".into(), value: "1".into() }],
        headers: vec![ApiRequestPair { name: "X-Trace".into(), value: "request-42".into() }],
        body: ApiRequestBodyInput::Json { value: "{\"ok\":true}".into() },
    };
    let summary = session.prepare_api_request(request.clone()).unwrap();
    assert_eq!(summary.path, "/v1/users/%7Eada");
    assert_eq!(summary.method, "POST");
    assert!(summary.mutation);
    let safe = serde_json::to_string(&summary).unwrap();
    assert!(!safe.contains("desktop-request-token-canary"));
    assert!(!safe.contains("protected-header-canary"));
    assert!(!safe.contains("request-42"));

    let plan = session.compile_api_request(
        request.clone(), summary.environment_revision,
        &summary.environment_policy_digest, &summary.request_digest,
    ).unwrap();
    match plan.authentication {
        ApiRequestAuthenticationMaterial::Bearer { token } => {
            assert_eq!(token.as_str(), "desktop-request-token-canary");
        }
        _ => panic!("expected bearer material"),
    }
    assert!(plan.headers.iter().any(|header| {
        header.name == "x-protected" && header.value.as_str() == "protected-header-canary"
    }));
    assert!(plan.canaries.iter().any(|value| value == "desktop-request-token-canary"));
    assert!(plan.canaries.iter().any(|value| value == "protected-header-canary"));

    let mut changed = api_environment_input(service.id, token.id);
    changed.name = "Changed".into();
    session.update_api_environment(ApiEnvironmentUpdate { id: created.id, input: changed }).unwrap();
    assert_eq!(
        session.compile_api_request(
            request, summary.environment_revision,
            &summary.environment_policy_digest, &summary.request_digest,
        ).err(),
        Some(VaultError::ApiRequestPlanStale)
    );
}

#[test]
fn api_request_plan_supports_none_basic_and_api_key_without_unsafe_overrides() {
    let mut session = VaultSession::create("correct horse battery staple").unwrap();
    let service = session.add_service(new_service("Example", "https://example.test")).unwrap();
    let login = session.add_item(new_item("Basic", "basic-password-canary")).unwrap();
    let api_key = session.add_secret(api_secret(
        SecretItemKind::ApiKey, "API key", "api-key-canary-value",
    )).unwrap();
    let placeholder = session.add_secret(api_secret(
        SecretItemKind::AccessToken, "Placeholder", "placeholder-token",
    )).unwrap();

    let mut none = api_environment_input(service.id, placeholder.id);
    none.name = "None".into();
    none.auth = ApiEnvironmentAuth::None;
    let none = session.add_api_environment(none).unwrap();

    let mut basic = api_environment_input(service.id, placeholder.id);
    basic.name = "Basic".into();
    basic.auth = ApiEnvironmentAuth::Basic {
        username: ApiCredentialRef {
            item_kind: ApiCredentialItemKind::Login, item_id: login.id,
            field: ApiCredentialField::LoginUsername, expected_secret_kind: None,
        },
        password: ApiCredentialRef {
            item_kind: ApiCredentialItemKind::Login, item_id: login.id,
            field: ApiCredentialField::LoginPassword, expected_secret_kind: None,
        },
    };
    let basic = session.add_api_environment(basic).unwrap();

    let mut keyed = api_environment_input(service.id, placeholder.id);
    keyed.name = "API key".into();
    keyed.auth = ApiEnvironmentAuth::ApiKey {
        location: ApiKeyLocation::Query, name: "api_key".into(),
        credential: secret_api_ref(api_key.id, SecretItemKind::ApiKey),
    };
    let keyed = session.add_api_environment(keyed).unwrap();

    let compile = |session: &VaultSession, id| {
        let input = ApiRequestInput {
            environment_id: id, method: "GET".into(), path: "/status".into(),
            query: Vec::new(), headers: Vec::new(), body: ApiRequestBodyInput::None,
        };
        let summary = session.prepare_api_request(input.clone()).unwrap();
        session.compile_api_request(
            input, summary.environment_revision,
            &summary.environment_policy_digest, &summary.request_digest,
        ).unwrap()
    };
    assert!(matches!(compile(&session, none.id).authentication, ApiRequestAuthenticationMaterial::None));
    match compile(&session, basic.id).authentication {
        ApiRequestAuthenticationMaterial::Basic { username, password } => {
            assert_eq!(username.as_str(), "ada@example.test");
            assert_eq!(password.as_str(), "basic-password-canary");
        }
        _ => panic!("expected basic material"),
    }
    match compile(&session, keyed.id).authentication {
        ApiRequestAuthenticationMaterial::ApiKey { location, name, value } => {
            assert_eq!(location, ApiKeyLocation::Query);
            assert_eq!(name, "api_key");
            assert_eq!(value.as_str(), "api-key-canary-value");
        }
        _ => panic!("expected api-key material"),
    }

    for invalid in [
        ApiRequestInput {
            environment_id: none.id, method: "get".into(), path: "/status".into(),
            query: Vec::new(), headers: Vec::new(), body: ApiRequestBodyInput::None,
        },
        ApiRequestInput {
            environment_id: none.id, method: "GET".into(), path: "/../admin".into(),
            query: Vec::new(), headers: Vec::new(), body: ApiRequestBodyInput::None,
        },
        ApiRequestInput {
            environment_id: none.id, method: "GET".into(), path: "/status".into(),
            query: Vec::new(), headers: vec![ApiRequestPair {
                name: "Authorization".into(), value: "ordinary".into(),
            }], body: ApiRequestBodyInput::None,
        },
        ApiRequestInput {
            environment_id: none.id, method: "GET".into(), path: "/status".into(),
            query: Vec::new(), headers: Vec::new(),
            body: ApiRequestBodyInput::Text { value: "not allowed".into() },
        },
    ] {
        assert_eq!(session.prepare_api_request(invalid).err(), Some(VaultError::InvalidApiRequest));
    }
}
