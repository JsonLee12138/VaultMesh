use super::*;

#[test]
fn ct_agent_web_native_callback_is_bounded_strict_and_typed() {
    let serialized = r#"{"status":"ok","fields":{"state":"ready"}}"#;
    let decoded = decode_evaluation_result(serialized).expect("callback");
    assert_eq!(decoded["fields"]["state"], "ready");
    assert!(decode_evaluation_result("not-json").is_err());
    assert!(decode_evaluation_result(&"x".repeat(128 * 1024 + 1)).is_err());

    let script = extract_script(&AgentWebRecipePolicy {
        name: "status".into(),
        kind: AgentWebRecipeKind::Extract,
        path: "/dashboard".into(),
        username_selector: None,
        password_selector: None,
        submit_selector: None,
        success_selector: None,
        failure_selector: None,
        selector: None,
        fields: vec![vaultmesh_ffi::AgentWebFieldPolicy {
            name: "state".into(),
            selector: "#state".into(),
            source: AgentWebFieldSource::Text,
        }],
        inputs: Vec::new(),
        risk: vaultmesh_ffi::AgentRiskTier::R1,
    })
    .unwrap();
    assert!(!script.contains("document.title"));
    assert!(!script.contains("localStorage"));
    assert!(!script.contains("cookie"));
}

#[test]
fn ct_agent_web_navigation_and_href_are_exact_origin_and_strip_query_material() {
    let origins = vec![String::from("https://portal.example.test")];
    assert!(approved_url(&origins[0], "/dashboard", &origins).is_ok());
    assert_eq!(
        sanitize_href(
            "https://portal.example.test/report?id=secret#token",
            &origins
        )
        .unwrap(),
        "https://portal.example.test/report"
    );
    assert!(sanitize_href("https://evil.example.test/", &origins).is_err());
}

#[test]
fn ct_agent_web_action_input_is_schema_exact_and_bounded() {
    let recipe = AgentWebRecipePolicy {
        name: "search".into(),
        kind: AgentWebRecipeKind::Action,
        path: "/dashboard".into(),
        username_selector: None,
        password_selector: None,
        submit_selector: None,
        success_selector: Some("#results".into()),
        failure_selector: None,
        selector: Some("#submit".into()),
        fields: Vec::new(),
        inputs: vec![vaultmesh_ffi::AgentWebInputPolicy {
            name: "query".into(),
            selector: "#query".into(),
            max_length: 8,
        }],
        risk: vaultmesh_ffi::AgentRiskTier::R2,
    };
    assert!(validate_action_input(&recipe, &json!({ "query": "status" })).is_ok());
    assert!(validate_action_input(&recipe, &json!({ "query": "too-long-value" })).is_err());
    assert!(validate_action_input(&recipe, &json!({ "query": "ok", "extra": "x" })).is_err());
}

#[test]
fn ct_agent_authn_passkey_scripts_capture_and_complete_only_the_bound_page_promise() {
    let recipe = AgentWebRecipePolicy {
        name: "register_passkey".into(),
        kind: AgentWebRecipeKind::PasskeyRegistration,
        path: "/account".into(),
        username_selector: None,
        password_selector: None,
        submit_selector: None,
        success_selector: None,
        failure_selector: None,
        selector: Some("#register-passkey".into()),
        fields: Vec::new(),
        inputs: Vec::new(),
        risk: vaultmesh_ffi::AgentRiskTier::R3,
    };
    let capture =
        passkey_capture_script(&recipe, "create", "opaque-completion-key").expect("capture script");
    assert!(capture.contains("requestDetailsJson"));
    assert!(capture.contains("remoteDesktopClientOverride"));
    assert!(capture.contains("Symbol.for(key)"));
    assert!(!capture.contains("privateKey"));
    let completion = passkey_completion_script(
            "opaque-completion-key",
            r#"{"id":"a","rawId":"YQ","type":"public-key","response":{"clientDataJSON":"YQ","attestationObject":"YQ","authenticatorData":"YQ","publicKey":"YQ","publicKeyAlgorithm":-7,"transports":["internal"]},"clientExtensionResults":{}}"#,
        )
        .expect("completion script");
    assert!(completion.contains("pending.resolve"));
    assert!(completion.contains("delete window[slot]"));
    assert!(!completion.contains("console."));
    let pending = passkey_pending_script("opaque-completion-key");
    assert!(pending.contains("typeof pending.resolve==='function'"));
    assert!(pending.contains("status:"));
    assert!(!pending.contains("console."));
}
