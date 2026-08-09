#[test]
fn payment_cards_validate_mask_and_round_trip_without_exposing_secrets() {
    let mut session = VaultSession::create("correct horse battery staple").unwrap();
    let card = session.add_card(new_card("Daily card")).unwrap();
    assert_eq!(card.masked_number, "•••• 1111");
    assert!(!format!("{card:?}").contains("4111111111111111"));

    let detail = session.card_detail(card.id).unwrap();
    assert_eq!(detail.masked_number, "•••• 1111");
    assert!(detail.has_security_code);
    assert!(detail.has_pin);
    assert_eq!(
        session.card_number_for_access(card.id, None).unwrap(),
        "4111111111111111"
    );
    assert_eq!(
        session
            .card_security_code_for_access(card.id, None)
            .unwrap(),
        "123"
    );
    assert_eq!(session.card_pin_for_access(card.id, None).unwrap(), "1234");
    assert!(
        session
            .card_number_matches(card.id, "4111111111111111")
            .unwrap()
    );
    assert!(
        !session
            .card_number_matches(card.id, "5555555555554444")
            .unwrap()
    );
    assert!(
        session
            .card_security_code_matches(card.id, Some("123"))
            .unwrap()
    );
    assert!(
        !session
            .card_security_code_matches(card.id, Some("999"))
            .unwrap()
    );
    assert!(session.card_security_code_matches(card.id, None).unwrap());

    let encrypted = session.save().unwrap();
    let serialized = String::from_utf8_lossy(&encrypted);
    assert!(!serialized.contains("4111111111111111"));
    assert!(!serialized.contains("Private address"));
    let reopened = VaultSession::unlock("correct horse battery staple", &encrypted).unwrap();
    assert_eq!(reopened.list_cards().unwrap(), vec![card]);

    let mut invalid = new_card("Invalid");
    invalid.card_number = "4111111111111112".into();
    assert_eq!(
        session.add_card(invalid).unwrap_err(),
        VaultError::InvalidCardNumber
    );
}

#[test]
fn payment_card_updates_history_trash_and_reprompt_are_enforced() {
    let mut session = VaultSession::create("correct horse battery staple").unwrap();
    let mut input = new_card("Original card");
    input.master_password_reprompt = true;
    let card = session.add_card(input).unwrap();
    assert_eq!(
        session.card_number_for_access(card.id, None),
        Err(VaultError::MasterPasswordRequired)
    );
    // Equality checks do not disclose the value and remain available for
    // duplicate/update planning even when direct access requires re-prompt.
    assert!(
        session
            .card_number_matches(card.id, "4111111111111111")
            .unwrap()
    );
    assert_eq!(
        session
            .card_number_for_access(card.id, Some("correct horse battery staple"))
            .unwrap(),
        "4111111111111111"
    );

    session
        .update_card(PaymentCardItemUpdate {
            id: card.id,
            title: "Updated card".into(),
            cardholder_name: "Ada Lovelace".into(),
            card_number: None,
            expiration_month: 1,
            expiration_year: 2031,
            security_code: None,
            clear_security_code: true,
            pin: None,
            clear_pin: false,
            issuer: Some("Example Bank".into()),
            network: Some("Visa".into()),
            billing_address: None,
            notes: None,
            folder: None,
            favorite: false,
            master_password_reprompt: false,
        })
        .unwrap();
    assert_eq!(
        session.card_security_code_for_access(card.id, None),
        Err(VaultError::CardSecretUnavailable)
    );
    let revision = session.card_history(card.id).unwrap()[0].clone();
    session
        .restore_card_revision(card.id, revision.revision_id)
        .unwrap();
    assert_eq!(session.card_detail(card.id).unwrap().title, "Original card");

    session.delete_card(card.id).unwrap();
    let trash = session.list_card_trash().unwrap();
    assert_eq!(trash[0].masked_number, "•••• 1111");
    session.restore_card_trash(trash[0].trash_id).unwrap();
    assert_eq!(session.list_cards().unwrap().len(), 1);
}

#[test]
fn identities_validate_encrypt_and_support_history_and_trash() {
    let mut session = VaultSession::create("correct horse battery staple").unwrap();
    let identity = session.add_identity(new_identity("Ada identity")).unwrap();
    assert_eq!(identity.display_name.as_deref(), Some("Ada Lovelace"));
    let detail = session.identity_detail(identity.id).unwrap();
    assert!(detail.emails[0].id != Uuid::nil());
    assert!(detail.addresses[0].id != Uuid::nil());
    let searched = session.search_identities("ada@example.test").unwrap();
    assert_eq!(searched, vec![identity.clone()]);
    assert!(!format!("{:?}", searched).contains("ada@example.test"));
    assert!(
        !format!("{:?}", session.payload_snapshot().unwrap().identities[0])
            .contains("Private identity note")
    );

    let encrypted = session.save().unwrap();
    assert!(!String::from_utf8_lossy(&encrypted).contains("Private identity note"));

    let mut updated = new_identity("Updated identity");
    updated.first_name = Some("Augusta".into());
    session.update_identity(updated, identity.id).unwrap();
    let revision = session.identity_history(identity.id).unwrap()[0].clone();
    session
        .restore_identity_revision(identity.id, revision.revision_id)
        .unwrap();
    assert_eq!(
        session.identity_detail(identity.id).unwrap().title,
        "Ada identity"
    );

    session.delete_identity(identity.id).unwrap();
    let trash = session.list_identity_trash().unwrap();
    assert_eq!(trash[0].title, "Ada identity");
    session.restore_identity_trash(trash[0].trash_id).unwrap();
    assert_eq!(session.list_identities().unwrap().len(), 1);

    let mut invalid = new_identity("Invalid");
    invalid.emails[0].value = "not-an-email".into();
    assert_eq!(
        session.add_identity(invalid).unwrap_err(),
        VaultError::InvalidIdentity
    );
}

#[test]
fn identities_allow_partial_profiles_normalize_input_and_reject_invalid_updates_atomically() {
    let mut session = VaultSession::create("correct horse battery staple").unwrap();
    let partial = session
        .add_identity(NewIdentityItem {
            title: "  Just a title  ".into(),
            first_name: None,
            middle_name: None,
            last_name: None,
            birth_date: None,
            emails: Vec::new(),
            phones: Vec::new(),
            addresses: Vec::new(),
            organization: None,
            department: None,
            job_title: None,
            website: None,
            notes: Some("  note  ".into()),
            folder: None,
            favorite: false,
        })
        .unwrap();
    assert_eq!(partial.title, "Just a title");
    assert_eq!(
        session
            .identity_detail(partial.id)
            .unwrap()
            .notes
            .as_deref(),
        Some("note")
    );

    let original = session.add_identity(new_identity("Original")).unwrap();
    let mut malformed = new_identity("Malformed");
    malformed.birth_date = Some("2023-02-29".into());
    assert_eq!(
        session.update_identity(malformed, original.id),
        Err(VaultError::InvalidIdentity)
    );
    assert_eq!(
        session.identity_detail(original.id).unwrap().title,
        "Original"
    );

    let mut preferred_conflict = new_identity("Conflict");
    preferred_conflict.emails.push(IdentityValue {
        id: Uuid::nil(),
        label: "Other".into(),
        value: "other@example.test".into(),
        preferred: true,
    });
    assert_eq!(
        session.add_identity(preferred_conflict),
        Err(VaultError::InvalidIdentity)
    );

    let mut normalized = new_identity("Normalized");
    normalized.addresses[0].country_code = Some(" gb ".into());
    let normalized = session.add_identity(normalized).unwrap();
    assert_eq!(
        session.identity_detail(normalized.id).unwrap().addresses[0]
            .country_code
            .as_deref(),
        Some("GB")
    );
}

#[test]
fn ssh_credentials_round_trip_without_exposing_secret_material() {
    let mut session = VaultSession::create("correct horse battery staple").unwrap();
    let ssh = session
        .add_ssh_credential(new_ssh("Production SSH"))
        .unwrap();
    assert_eq!(ssh.host.as_deref(), Some("server.example.test"));
    assert_eq!(ssh.record_kind, SshCredentialRecordKind::Account);
    assert_eq!(ssh.key_algorithm.as_deref(), Some("ssh-ed25519"));
    assert!(
        ssh.public_key_fingerprint
            .as_deref()
            .is_some_and(|value| value.starts_with("SHA256:"))
    );
    assert!(
        ssh.has_password && ssh.has_public_key && ssh.has_private_key && ssh.has_key_passphrase
    );
    let debug = format!("{:?}", session.payload_snapshot().unwrap().ssh_items[0]);
    assert!(!debug.contains("ssh-password"));
    assert!(!debug.contains("private-material"));

    let detail = session.ssh_credential_detail(ssh.id).unwrap();
    assert_eq!(detail.title, "Production SSH");
    assert!(detail.has_private_key);
    assert_eq!(
        session.ssh_password_for_access(ssh.id, None).unwrap(),
        "ssh-password"
    );
    assert!(
        session
            .ssh_public_key_for_access(ssh.id)
            .unwrap()
            .starts_with("ssh-ed25519 ")
    );
    assert!(
        session
            .ssh_private_key_for_access(ssh.id, None)
            .unwrap()
            .contains("private-material")
    );

    let encrypted = session.save().unwrap();
    let serialized = String::from_utf8_lossy(&encrypted);
    assert!(!serialized.contains("private-material"));
    let reopened = VaultSession::unlock("correct horse battery staple", &encrypted).unwrap();
    assert_eq!(reopened.list_ssh_credentials().unwrap(), vec![ssh]);
}

#[test]
fn managed_ssh_host_binding_is_encrypted_idempotent_and_fail_closed() {
    let password = "correct horse battery staple";
    let host_key = format!("SHA256:{}", "a".repeat(43));
    let mut session = VaultSession::create(password).unwrap();
    let account = session
        .add_ssh_credential(new_ssh("Home server"))
        .unwrap();
    assert_eq!(
        session
            .managed_ssh_host_key_id(account.id, "home-server", &host_key)
            .unwrap(),
        None
    );

    let key_id = session
        .add_managed_ssh_host_key(
            account.id,
            "home-server".into(),
            host_key.clone(),
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGV4YW1wbGU= managed@test".into(),
            "-----BEGIN OPENSSH PRIVATE KEY-----\nmanaged-private-material\n-----END OPENSSH PRIVATE KEY-----".into(),
        )
        .unwrap();
    assert_eq!(
        session
            .managed_ssh_host_key_id(account.id, "home-server", &host_key)
            .unwrap(),
        Some(key_id)
    );
    let summaries = session.list_ssh_credentials().unwrap();
    let managed = summaries.iter().find(|item| item.id == key_id).unwrap();
    assert_eq!(managed.record_kind, SshCredentialRecordKind::Key);
    assert_eq!(managed.managed_ssh_alias.as_deref(), Some("home-server"));
    let renderer_safe = serde_json::to_string(managed).unwrap();
    assert!(renderer_safe.contains("home-server"));
    assert!(!renderer_safe.contains(&host_key));
    assert_eq!(
        session
            .ssh_credential_detail(key_id)
            .unwrap()
            .managed_ssh_alias
            .as_deref(),
        Some("home-server")
    );

    let encrypted = session.save().unwrap();
    let ciphertext = String::from_utf8_lossy(&encrypted);
    assert!(!ciphertext.contains("home-server"));
    assert!(!ciphertext.contains("managed-private-material"));
    let mut reopened = VaultSession::unlock(password, &encrypted).unwrap();
    assert_eq!(
        reopened
            .managed_ssh_host_key_id(account.id, "home-server", &host_key)
            .unwrap(),
        Some(key_id)
    );
    assert_eq!(
        reopened
            .managed_ssh_host_key_id(account.id, "other-server", &host_key)
            .unwrap(),
        None
    );
    assert_eq!(
        reopened
            .managed_ssh_host_key_id(
                account.id,
                "home-server",
                &format!("SHA256:{}", "b".repeat(43)),
            )
            .unwrap_err(),
        VaultError::InvalidSshCredential
    );
    let debug = format!("{:?}", reopened.payload_snapshot().unwrap().ssh_items[1]);
    assert!(!debug.contains("server.example.test"));
    assert!(!debug.contains(&host_key));
    reopened.delete_ssh_credential(key_id).unwrap();
    assert_eq!(
        reopened
            .managed_ssh_host_key_id(account.id, "home-server", &host_key)
            .unwrap_err(),
        VaultError::InvalidSshCredential
    );
}

#[test]
fn ssh_validation_duplicate_import_update_and_lifecycle_are_enforced() {
    let mut session = VaultSession::create("correct horse battery staple").unwrap();
    let mut invalid = new_ssh("Invalid");
    invalid.password = None;
    invalid.public_key = None;
    invalid.private_key = None;
    invalid.key_passphrase = None;
    invalid.title = "   ".into();
    assert_eq!(
        session.add_ssh_credential(invalid).unwrap_err(),
        VaultError::InvalidSshCredential
    );

    let mut protected = new_ssh("Protected");
    protected.master_password_reprompt = true;
    let ssh = session.add_ssh_credential(protected).unwrap();
    assert!(
        session
            .has_ssh_key_material(
                Some("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGV4YW1wbGU= renamed@test"),
                None,
            )
            .unwrap()
    );
    assert!(session
        .has_ssh_key_material(
            None,
            Some("-----BEGIN OPENSSH PRIVATE KEY-----\nprivate-material\n-----END OPENSSH PRIVATE KEY-----"),
        )
        .unwrap());
    assert!(!session
        .has_ssh_key_material(
            None,
            Some("-----BEGIN OPENSSH PRIVATE KEY-----\nother-material\n-----END OPENSSH PRIVATE KEY-----"),
        )
        .unwrap());
    assert_eq!(
        session.ssh_private_key_for_access(ssh.id, None),
        Err(VaultError::MasterPasswordRequired)
    );
    assert!(
        session
            .ssh_private_key_for_access(ssh.id, Some("correct horse battery staple"))
            .is_ok()
    );

    let mut private_only = new_ssh("Private only");
    private_only.host = None;
    private_only.username.clear();
    private_only.password = None;
    private_only.public_key = None;
    private_only.private_key = Some(
        "-----BEGIN OPENSSH PRIVATE KEY-----\nprivate-only-material\n-----END OPENSSH PRIVATE KEY-----"
            .into(),
    );
    private_only.key_passphrase = None;
    private_only.folder = None;
    private_only.favorite = false;
    let private_only = session.add_ssh_credential(private_only).unwrap();
    assert_eq!(private_only.record_kind, SshCredentialRecordKind::Key);
    let added_public_key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGV4YW1wbGU= added-later@test";
    session
        .update_ssh_credential(SshCredentialItemUpdate {
            id: private_only.id,
            title: private_only.title.clone(),
            host: private_only.host.clone(),
            port: private_only.port,
            username: private_only.username.clone(),
            password: None,
            clear_password: false,
            public_key: Some(added_public_key.into()),
            clear_public_key: false,
            private_key: None,
            clear_private_key: false,
            key_passphrase: None,
            clear_key_passphrase: false,
            notes: private_only.notes.clone(),
            folder: None,
            favorite: false,
            master_password_reprompt: private_only.master_password_reprompt,
        })
        .unwrap();
    assert_eq!(
        session.ssh_public_key_for_access(private_only.id).unwrap(),
        added_public_key
    );
    assert!(
        session
            .ssh_private_key_for_access(private_only.id, None)
            .unwrap()
            .contains("private-only-material")
    );

    let (imported, skipped) = session
        .import_ssh_credentials(vec![new_ssh("Duplicate"), {
            let mut unique = new_ssh("Password only");
            unique.public_key = None;
            unique.private_key = None;
            unique.key_passphrase = None;
            unique.password = Some("different".into());
            unique
        }])
        .unwrap();
    assert_eq!(imported.len(), 1);
    assert_eq!(skipped, 1);

    session
        .update_ssh_credential(SshCredentialItemUpdate {
            id: ssh.id,
            title: "Updated SSH".into(),
            host: Some("new.example.test".into()),
            port: 2222,
            username: "root".into(),
            password: None,
            clear_password: true,
            public_key: None,
            clear_public_key: false,
            private_key: None,
            clear_private_key: false,
            key_passphrase: None,
            clear_key_passphrase: false,
            notes: None,
            folder: None,
            favorite: false,
            master_password_reprompt: false,
        })
        .unwrap();
    assert_eq!(
        session.ssh_password_for_access(ssh.id, None),
        Err(VaultError::SshSecretUnavailable)
    );
    let revision = session.ssh_history(ssh.id).unwrap()[0].clone();
    session
        .restore_ssh_revision(ssh.id, revision.revision_id)
        .unwrap();
    assert_eq!(
        session.ssh_credential_detail(ssh.id).unwrap().title,
        "Protected"
    );
    session.delete_ssh_credential(ssh.id).unwrap();
    let trash = session.list_ssh_trash().unwrap();
    assert_eq!(trash[0].title, "Protected");
    session.restore_ssh_trash(trash[0].trash_id).unwrap();
    assert_eq!(session.list_ssh_credentials().unwrap().len(), 3);
}

#[test]
fn developer_secrets_are_classified_hidden_and_reprompt_protected() {
    let mut session = VaultSession::create("correct horse battery staple").unwrap();
    let summary = session
        .add_secret(NewSecretItem {
            title: "  GitHub work token  ".into(),
            kind: SecretItemKind::AccessToken,
            provider: Some(" GitHub ".into()),
            account: Some("ada".into()),
            secret: "ghp_private_value".into(),
            environment: Some("Production".into()),
            scopes: vec![" repo ".into(), "read:org".into(), "repo".into()],
            expires_at: Some("2030-12-31".into()),
            website: Some("https://github.com/settings/tokens".into()),
            notes: None,
            folder: Some("Work".into()),
            favorite: true,
            master_password_reprompt: true,
        })
        .unwrap();

    assert_eq!(summary.title, "GitHub work token");
    assert_eq!(summary.provider.as_deref(), Some("GitHub"));
    assert_eq!(
        session.secret_detail(summary.id).unwrap().scopes,
        vec!["read:org", "repo"]
    );
    assert_eq!(
        session.secret_value_for_access(summary.id, None),
        Err(VaultError::MasterPasswordRequired)
    );
    assert_eq!(
        session
            .secret_value_for_access(summary.id, Some("correct horse battery staple"))
            .unwrap()
            .as_str(),
        "ghp_private_value"
    );

    session
        .update_secret(SecretItemUpdate {
            id: summary.id,
            title: "GitHub token".into(),
            kind: SecretItemKind::AccessToken,
            provider: Some("GitHub".into()),
            account: Some("ada".into()),
            secret: None,
            environment: Some("Production".into()),
            scopes: vec!["repo".into()],
            expires_at: None,
            website: None,
            notes: None,
            folder: None,
            favorite: false,
            master_password_reprompt: false,
        })
        .unwrap();
    assert_eq!(
        session
            .secret_value_for_access(summary.id, None)
            .unwrap()
            .as_str(),
        "ghp_private_value"
    );
    session.delete_secret(summary.id).unwrap();
    assert!(session.list_secrets().unwrap().is_empty());
}
