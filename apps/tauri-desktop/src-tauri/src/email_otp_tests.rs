use super::*;

#[test]
fn otp_extraction_requires_context_and_deduplicates() {
    assert_eq!(
        extract_codes("Your verification code is 123456. OTP 123456"),
        ["123456"]
    );
    assert_eq!(extract_codes("Your code is 246810"), ["246810"]);
    assert_eq!(extract_codes("135790 is your sign-in code"), ["135790"]);
    assert_eq!(extract_codes("您的登录代码：482103"), ["482103"]);
    assert_eq!(
        extract_codes("<p>Your code is <strong>&#54;&#53;&#52;&#51;&#50;&#49;</strong></p>"),
        ["654321"]
    );
    assert_eq!(extract_codes("invoice 123456"), Vec::<String>::new());
    assert_eq!(extract_codes("postal code 12345"), Vec::<String>::new());
    assert_eq!(extract_codes("source code 123456"), Vec::<String>::new());
    assert_eq!(extract_codes("验证码：4821，有效 5 分钟"), ["4821"]);
}

#[test]
fn otp_extraction_preserves_alphanumeric_tokens_without_brand_false_positives() {
    assert_eq!(
        extract_codes(
            "您好，你正在进行7315CODE邮箱验证。\n\
                 您的验证码为: **48271q**\n\
                 验证码 10 分钟内有效，如果不是本人操作，请忽略。"
        ),
        ["48271q"]
    );
    assert_eq!(
        extract_codes("Your verification code is A9b2C3"),
        ["A9b2C3"]
    );
    assert_eq!(
        extract_codes("Your verification code is x48271qZ9"),
        Vec::<String>::new()
    );
    assert_eq!(extract_codes("7315CODE邮箱验证"), Vec::<String>::new());
}

#[test]
fn gmail_query_uses_an_exact_epoch_cutoff() {
    let mut settings = EmailOtpSettings::default();
    assert_eq!(
        gmail_query(&settings, 1_700_000_000),
        "after:1700000000 is:unread"
    );
    settings.only_unread_messages = false;
    assert_eq!(gmail_query(&settings, 1_700_000_000), "after:1700000000");
}

#[test]
fn plaintext_imap_is_bounded_to_local_networks() {
    assert!(is_local_or_private("localhost"));
    assert!(is_local_or_private("192.168.1.20"));
    assert!(!is_local_or_private("imap.example.com"));
    assert!(
        validate_transport_policy(&json!({
            "imapHost": "imap.example.com",
            "useTls": false,
        }))
        .is_err()
    );
}

#[test]
fn settings_reject_out_of_range_policies() {
    let invalid = EmailOtpSettings {
        poll_interval_seconds: 1,
        ..EmailOtpSettings::default()
    };
    assert!(!invalid.validate());

    let path = std::env::temp_dir().join(format!(
        "vaultmesh-email-global-settings-{}.json",
        Uuid::new_v4()
    ));
    let legacy = EmailOtpSettings {
        require_domain_match: true,
        ..EmailOtpSettings::default()
    };
    std::fs::write(&path, serde_json::to_vec(&legacy).expect("legacy settings"))
        .expect("write legacy settings");
    let service = EmailOtpService::new(path.clone());
    assert!(!service.settings.require_domain_match);
    let _ = std::fs::remove_file(path);
}

#[test]
fn browser_candidates_are_global_and_boost_is_origin_bounded() {
    let root = std::env::temp_dir().join(format!("vaultmesh-email-browser-{}", Uuid::new_v4()));
    let mut service = EmailOtpService::new(root.join("settings.json"));
    service.settings.enabled = true;
    service.settings.poll_interval_seconds = 10;
    service.last_poll_at = 100;
    let candidate_id = Uuid::new_v4();
    service.candidates.push(Candidate {
        id: candidate_id,
        account_id: Uuid::new_v4(),
        account_address: "private@example.test".into(),
        code: "A9b2C3".into(),
        sender: "Security <no-reply@example.test>".into(),
        subject: "Private verification subject".into(),
        received_at: 101,
        message_id: "private-message-id".into(),
        expires_at: 191,
    });

    let boost = service
        .start_browser_boost("https://login.example.test", 101)
        .expect("boost");
    assert_eq!(
        boost.get("boostExpiresAt").and_then(Value::as_u64),
        Some(191)
    );
    assert!(service.poll_due(103));
    let matched = service
        .browser_candidates("https://login.example.test", 103)
        .expect("matching candidates");
    assert_eq!(matched["candidates"].as_array().map(Vec::len), Some(1));
    assert_eq!(matched["candidates"][0]["id"], json!(candidate_id));
    assert!(matched.to_string().contains("A9b2C3"));
    assert!(!matched.to_string().contains("private@example.test"));
    assert!(!matched.to_string().contains("Private verification subject"));
    assert!(!matched.to_string().contains("private-message-id"));
    let cross_site = service
        .browser_candidates("https://evil.test", 103)
        .expect("cross-site candidates");
    assert_eq!(cross_site["candidates"].as_array().map(Vec::len), Some(1));
    assert_eq!(cross_site["candidates"][0]["id"], json!(candidate_id));
    assert_eq!(
        service
            .browser_candidate_code(candidate_id, "https://evil.test", 103)
            .expect("cross-site candidate remains selectable")
            .as_str(),
        "A9b2C3"
    );
    service
        .stop_browser_boost(Some("https://login.example.test"))
        .expect("stop boost");
    assert!(!service.browser_boost_active(103));
}

#[test]
fn agent_candidate_is_exact_account_bounded_expiring_and_one_use() {
    let root = std::env::temp_dir().join(format!("vaultmesh-email-agent-{}", Uuid::new_v4()));
    let mut service = EmailOtpService::new(root.join("settings.json"));
    let approved_account = Uuid::new_v4();
    for (account_id, code, received_at, expires_at) in [
        (Uuid::new_v4(), "wrong-account", 105, 250),
        (approved_account, "older-code", 101, 190),
        (approved_account, "newest-code", 104, 190),
    ] {
        service.candidates.push(Candidate {
            id: Uuid::new_v4(),
            account_id,
            account_address: "private@example.test".into(),
            code: code.into(),
            sender: "Security <no-reply@example.test>".into(),
            subject: "Verification".into(),
            received_at,
            message_id: Uuid::new_v4().to_string(),
            expires_at,
        });
    }

    assert_eq!(
        service
            .take_agent_candidate_code(approved_account, "https://login.example.test", 110,)
            .unwrap()
            .as_str(),
        "newest-code"
    );
    assert_eq!(
        service
            .take_agent_candidate_code(approved_account, "https://login.example.test", 111,)
            .unwrap()
            .as_str(),
        "older-code"
    );
    assert!(
        service
            .take_agent_candidate_code(approved_account, "https://login.example.test", 191,)
            .is_err()
    );
    assert_eq!(service.candidates.len(), 1);
}

#[test]
fn oauth_callback_requires_matching_state_and_pkce_is_stable() {
    assert_eq!(
        oauth_callback_code("http://127.0.0.1/?code=abc&state=expected", "expected").expect("code"),
        "abc"
    );
    assert!(oauth_callback_code("http://127.0.0.1/?code=abc&state=wrong", "expected").is_err());
    assert!(
        oauth_callback_code(
            "http://127.0.0.1/?error=access_denied&state=expected",
            "expected"
        )
        .is_err()
    );
    assert_eq!(
        pkce_challenge("verifier"),
        "iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ"
    );
}

#[test]
fn gmail_payload_parsing_and_candidate_lifecycle_are_bounded() {
    let mut raw = concat!(
        "From: Security <security@example.test>\r\n",
        "Subject: Your sign-in code\r\n",
        "MIME-Version: 1.0\r\n",
        "Content-Type: multipart/mixed; boundary=outer\r\n",
        "\r\n",
        "--outer\r\n",
        "Content-Type: multipart/alternative; boundary=inner\r\n",
        "\r\n",
        "--inner\r\n",
        "Content-Type: text/plain; charset=utf-8\r\n",
        "Content-Transfer-Encoding: quoted-printable\r\n",
        "\r\n",
        "Your code is 654321\r\n",
        "--inner\r\n",
        "Content-Type: text/html; charset=utf-8\r\n",
        "\r\n",
        "<p>Your code is <strong>&#54;&#53;&#52;&#51;&#50;&#49;</strong></p>\r\n",
        "--inner--\r\n",
        "--outer\r\n",
        "Content-Type: text/plain\r\n",
        "Content-Disposition: attachment; filename=ignored.txt\r\n",
        "\r\n",
        "Attachment code is 999999\r\n",
        "--outer--\r\n",
    )
    .to_owned();
    while raw.len().is_multiple_of(3) {
        raw.push(' ');
    }
    let encoded = URL_SAFE.encode(raw);
    assert!(encoded.ends_with('='));
    let message = gmail_message(&json!({
        "id": "gmail-message-1",
        "internalDate": "1700000000000",
        "raw": encoded,
    }))
    .expect("message");
    assert_eq!(message.received_at, 1_700_000_000);
    assert_eq!(extract_codes(&message.text), ["654321"]);
    assert!(!message.text.contains("999999"));
    assert_eq!(
        decode_base64url(&URL_SAFE_NO_PAD.encode("unpadded")),
        Some(b"unpadded".to_vec())
    );

    let root = std::env::temp_dir().join(format!("vaultmesh-email-state-{}", Uuid::new_v4()));
    let mut service = EmailOtpService::new(root.join("settings.json"));
    service.settings.enabled = true;
    let account = EmailAccount {
        id: Uuid::new_v4(),
        label: "Mail".into(),
        address: "ada@example.test".into(),
        provider: "gmail".into(),
        auth_kind: "oauth".into(),
        credential: "secret".into(),
        imap_host: "gmail.googleapis.com".into(),
        imap_port: 443,
        use_tls: true,
        enabled: true,
    };
    service.ingest(&account, vec![message.clone(), message], 1_700_000_000);
    assert_eq!(service.candidates.len(), 1);
    assert_eq!(service.candidates[0].code, "654321");

    let retry_id = "gmail-message-retry".to_owned();
    service.ingest(
        &account,
        vec![Message {
            id: retry_id.clone(),
            sender: "security@example.test".into(),
            subject: "Account notice".into(),
            text: "No candidate in this first parse.".into(),
            received_at: 1_700_000_001,
        }],
        1_700_000_001,
    );
    assert!(!service.seen[&account.id].contains(&retry_id));
    service.ingest(
        &account,
        vec![Message {
            id: retry_id.clone(),
            sender: "security@example.test".into(),
            subject: "Account notice".into(),
            text: "Your login code is 112233".into(),
            received_at: 1_700_000_001,
        }],
        1_700_000_001,
    );
    assert!(service.seen[&account.id].contains(&retry_id));
    assert_eq!(service.candidates.len(), 2);
    assert_eq!(service.candidates[0].code, "112233");
    assert!(service.poll_due(1_700_000_000));
    service.last_poll_at = 1_700_000_000;
    assert!(!service.poll_due(1_700_000_001));
    service.prune(1_700_000_001 + service.settings.code_lifetime_seconds);
    assert!(service.candidates.is_empty());
    service.clear_runtime_state();
    assert!(service.seen.is_empty());
    assert_eq!(service.last_poll_at, 0);
}

#[test]
fn stale_scan_results_are_discarded_after_account_changes() {
    let root = std::env::temp_dir().join(format!("vaultmesh-email-stale-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).expect("temp dir");
    let mut runtime = DesktopRuntime::new(root.join("vaultmesh.vault")).expect("runtime");
    runtime
        .create("correct horse battery staple".into())
        .expect("create");
    let mut service = EmailOtpService::new(root.join("settings.json"));
    let summary = service
        .add_account(
            &mut runtime,
            json!({
                "label": "Local", "address": "ada@example.test",
                "provider": "custom-imap", "authKind": "app-password",
                "credential": "provider-secret", "imapHost": "127.0.0.1",
                "imapPort": 1143, "useTls": false, "enabled": true,
            }),
        )
        .expect("add");
    let id = summary["id"].as_str().expect("id");
    let snapshot: EmailAccount = serde_json::from_value(
        runtime_value(&mut runtime, "_native.email.account", json!({ "id": id })).expect("detail"),
    )
    .expect("account");
    service
        .update_account(
            &mut runtime,
            json!({
                "id": id, "label": "Changed while scanning", "address": "ada@example.test",
                "provider": "custom-imap", "authKind": "app-password",
                "credential": null, "imapHost": "127.0.0.1", "imapPort": 1143,
                "useTls": false, "enabled": true,
            }),
        )
        .expect("update");
    service.scan_in_progress = true;
    let execution = EmailScanExecution {
        results: vec![EmailAccountScanResult {
            account: snapshot,
            outcome: Ok(EmailAccountScanOutput {
                messages: vec![Message {
                    id: "stale-message".into(),
                    sender: "security@example.test".into(),
                    subject: "Your login code".into(),
                    text: "Your code is 123456".into(),
                    received_at: 1_700_000_000,
                }],
                refreshed_credential: None,
            }),
        }],
        now: 1_700_000_000,
    };
    let result = service
        .finish_scan(&mut runtime, execution)
        .expect("finish");
    assert!(result.as_array().is_some_and(Vec::is_empty));
    assert!(service.candidates.is_empty());
    assert!(!service.scan_in_progress);

    runtime.lock();
    drop(runtime);
    std::fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn account_crud_returns_only_renderer_safe_summaries() {
    let root = std::env::temp_dir().join(format!("vaultmesh-email-service-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).expect("temp dir");
    let vault_path = root.join("vaultmesh.vault");
    let mut runtime = DesktopRuntime::new(vault_path).expect("runtime");
    runtime
        .create("correct horse battery staple".into())
        .expect("create");
    let mut service = EmailOtpService::new(root.join("settings.json"));
    let account = service
        .add_account(
            &mut runtime,
            json!({
                "label": "Local", "address": "ada@example.test",
                "provider": "custom-imap", "authKind": "app-password",
                "credential": "provider-secret", "imapHost": "imap.example.test",
                "imapPort": 993, "useTls": true, "enabled": true,
            }),
        )
        .expect("add");
    assert_eq!(account["status"], "untested");
    assert!(!account.to_string().contains("provider-secret"));
    let id = account["id"].as_str().expect("id");
    let updated = service
        .update_account(
            &mut runtime,
            json!({
                "id": id, "label": "Local paused", "address": "ada@example.test",
                "provider": "custom-imap", "authKind": "app-password",
                "credential": null, "imapHost": "imap.example.test",
                "imapPort": 993, "useTls": true, "enabled": false,
            }),
        )
        .expect("update");
    assert_eq!(updated["enabled"], false);
    let listed = service.accounts(&mut runtime).expect("accounts");
    assert_eq!(listed.as_array().map(Vec::len), Some(1));
    assert!(!listed.to_string().contains("provider-secret"));
    service
        .delete_account(&mut runtime, json!({ "id": id }))
        .expect("delete");
    assert!(
        service
            .accounts(&mut runtime)
            .expect("empty")
            .as_array()
            .is_some_and(Vec::is_empty)
    );
    runtime.lock();
    drop(runtime);
    std::fs::remove_dir_all(root).expect("cleanup");
}
