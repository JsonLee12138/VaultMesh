use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Map, Value, json};
use uuid::Uuid;
use vaultmesh_core::{
    ApiEnvironmentUpdate, EmailAccountRecordUpdate, LoginItemUpdate, NewApiEnvironment,
    NewEmailAccountRecord, NewIdentityItem,
    NewLoginItem, NewPaymentCardItem, NewSecretItem, NewSshCredentialItem, PaymentCardItemUpdate,
    NewServiceRecord, SecretItemUpdate, ServiceIgnoredSuggestion, ServiceRecordUpdate,
    ServiceRelationship, SshCredentialItemUpdate, UnlockEventSource, VaultError, VaultSession,
};
use zeroize::Zeroizing;

use crate::{
    VAULTMESH_STATUS_CONFLICT, VAULTMESH_STATUS_CORE_ERROR, VAULTMESH_STATUS_INVALID_ARGUMENT,
    VAULTMESH_STATUS_IO_ERROR, VAULTMESH_STATUS_OK, VaultmeshBuffer, VaultmeshBytes,
    VaultmeshStatus, VaultmeshVault,
    buffer::initialize_out_buffer,
    status::{check_abi, ffi_boundary},
    storage::{read_vault, write_vault},
    vault::{map_core_error, mutation_lock, vault_fingerprint},
};

/// Executes a core-owned Browser RPC operation and returns its JSON result.
/// Ordinary operations are renderer-safe; the sole custom-field-bearing login
/// detail is authorized as a fresh-gesture privileged route by the shared RPC
/// policy. Secret-copy and page-fill values use separate privileged entry
/// points and never pass through this channel.
///
/// # Safety
///
/// Every byte view must remain readable for the call. `vault` must be a live
/// handle and `out_json` writable empty storage.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn vaultmesh_browser_core_operation(
    abi_version: u32,
    vault: *mut VaultmeshVault,
    operation: VaultmeshBytes,
    input_json: VaultmeshBytes,
    out_json: *mut VaultmeshBuffer,
) -> VaultmeshStatus {
    ffi_boundary(|| {
        // SAFETY: forwarded from the exported operation contract.
        if let Err(status) = unsafe { initialize_out_buffer(out_json) } {
            return status;
        }
        if let Err(status) = check_abi(abi_version) {
            return status;
        }
        if vault.is_null() {
            return VAULTMESH_STATUS_INVALID_ARGUMENT;
        }
        // SAFETY: byte-view validity is part of the exported operation contract.
        let operation = match unsafe { operation.as_utf8() } {
            Ok(value) if !value.is_empty() => value,
            _ => return VAULTMESH_STATUS_INVALID_ARGUMENT,
        };
        // SAFETY: byte-view validity is part of the exported operation contract.
        let input = match unsafe { input_json.as_slice() }
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(bytes).ok())
        {
            Some(value @ Value::Object(_)) => value,
            _ => return VAULTMESH_STATUS_INVALID_ARGUMENT,
        };
        // SAFETY: the caller contract requires a live opaque handle.
        let vault = unsafe { &mut *vault };
        let result = match execute_core_operation(vault, operation, input) {
            Ok(value) => value,
            Err(status) => return status,
        };
        let encoded = match serde_json::to_vec(&result) {
            Ok(bytes) => bytes,
            Err(_) => return VAULTMESH_STATUS_CORE_ERROR,
        };
        // SAFETY: `out_json` was initialized and remains writable.
        unsafe { *out_json = VaultmeshBuffer::from_vec(encoded) };
        VAULTMESH_STATUS_OK
    })
}

/// Shared safe Rust entry point used by the Tauri desktop runtime. It keeps
/// the same validation, naming and commit-before-publish behavior as the FFI
/// browser operation without crossing an ABI boundary.
pub(crate) fn execute_core_operation(
    vault: &mut VaultmeshVault,
    operation: &str,
    input: Value,
) -> Result<Value, VaultmeshStatus> {
    if operation.is_empty() {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT);
    }
    let mut input = match input {
        Value::Object(value) => Value::Object(convert_keys(value, snake_key)),
        _ => return Err(VAULTMESH_STATUS_INVALID_ARGUMENT),
    };
    apply_browser_defaults(operation, &mut input);
    validate_browser_input(operation, &input).map_err(|()| VAULTMESH_STATUS_INVALID_ARGUMENT)?;
    let result = if is_mutation(operation) {
        transaction(vault, |session| dispatch(session, operation, input))
    } else {
        dispatch(&mut vault.session, operation, input)
    }?;
    Ok(camel_value(result))
}

fn apply_browser_defaults(operation: &str, input: &mut Value) {
    let Some(object) = input.as_object_mut() else {
        return;
    };
    match operation {
        "items.add" | "items.update" => {
            defaults(
                object,
                &[
                    ("folder", Value::Null),
                    ("favorite", json!(false)),
                    ("totp_secret", Value::Null),
                    (
                        "recovery_codes",
                        if operation == "items.add" {
                            json!([])
                        } else {
                            Value::Null
                        },
                    ),
                    ("additional_urls", json!([])),
                    ("autofill_on_page_load", json!(true)),
                    ("master_password_reprompt", json!(false)),
                    ("custom_fields", json!([])),
                ],
            );
            if operation == "items.update" {
                defaults(
                    object,
                    &[
                        ("clear_totp_secret", json!(false)),
                        ("clear_recovery_codes", json!(false)),
                    ],
                );
            }
        }
        "cards.add" | "cards.update" => {
            defaults(
                object,
                &[
                    ("security_code", Value::Null),
                    ("pin", Value::Null),
                    ("issuer", Value::Null),
                    ("network", Value::Null),
                    ("folder", Value::Null),
                    ("favorite", json!(false)),
                    ("master_password_reprompt", json!(false)),
                ],
            );
            if operation == "cards.update" {
                defaults(
                    object,
                    &[
                        ("clear_security_code", json!(false)),
                        ("clear_pin", json!(false)),
                    ],
                );
            }
        }
        "identities.add" | "identities.update" => {
            defaults(
                object,
                &[
                    ("first_name", Value::Null),
                    ("middle_name", Value::Null),
                    ("last_name", Value::Null),
                    ("birth_date", Value::Null),
                    ("emails", json!([])),
                    ("phones", json!([])),
                    ("addresses", json!([])),
                    ("organization", Value::Null),
                    ("department", Value::Null),
                    ("job_title", Value::Null),
                    ("website", Value::Null),
                    ("folder", Value::Null),
                    ("favorite", json!(false)),
                ],
            );
            for key in ["emails", "phones"] {
                if let Some(entries) = object.get_mut(key).and_then(Value::as_array_mut) {
                    for entry in entries.iter_mut().filter_map(Value::as_object_mut) {
                        defaults(
                            entry,
                            &[("id", json!(Uuid::new_v4())), ("preferred", json!(false))],
                        );
                    }
                }
            }
            if let Some(entries) = object.get_mut("addresses").and_then(Value::as_array_mut) {
                for entry in entries.iter_mut().filter_map(Value::as_object_mut) {
                    defaults(
                        entry,
                        &[
                            ("id", json!(Uuid::new_v4())),
                            ("address_line2", Value::Null),
                            ("city", Value::Null),
                            ("region", Value::Null),
                            ("postal_code", Value::Null),
                            ("country_code", Value::Null),
                            ("country", Value::Null),
                            ("preferred", json!(false)),
                        ],
                    );
                }
            }
        }
        "ssh.add" | "ssh.update" => {
            defaults(
                object,
                &[
                    ("host", Value::Null),
                    ("port", json!(22)),
                    ("password", Value::Null),
                    ("public_key", Value::Null),
                    ("private_key", Value::Null),
                    ("key_passphrase", Value::Null),
                    ("folder", Value::Null),
                    ("favorite", json!(false)),
                    ("master_password_reprompt", json!(false)),
                ],
            );
            if operation == "ssh.update" {
                defaults(
                    object,
                    &[
                        ("clear_password", json!(false)),
                        ("clear_public_key", json!(false)),
                        ("clear_private_key", json!(false)),
                        ("clear_key_passphrase", json!(false)),
                    ],
                );
            }
        }
        "secrets.add" | "secrets.update" => defaults(
            object,
            &[
                ("provider", Value::Null),
                ("account", Value::Null),
                ("environment", Value::Null),
                ("scopes", json!([])),
                ("expires_at", Value::Null),
                ("website", Value::Null),
                ("folder", Value::Null),
                ("favorite", json!(false)),
                ("master_password_reprompt", json!(false)),
            ],
        ),
        _ => {}
    }
}

fn validate_browser_input(operation: &str, input: &Value) -> Result<(), ()> {
    match operation {
        "vault.change-password" => {
            required_string(input, "current_password", 8, 1_024, false)?;
            required_string(input, "new_password", 8, 1_024, false).map(|_| ())
        }
        "browser.card.capture-status" => {
            optional_uuid_value(input, "card_id")?;
            required_string(input, "cardholder_name", 1, 256, true)?;
            let number = required_string(input, "card_number", 12, 19, false)?;
            if !number.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err(());
            }
            integer_in(input, "expiration_month", 1, 12)?;
            integer_in(input, "expiration_year", 1_000, 9_999)?;
            digit_string(input, "security_code", 3, 4, true)?;
            bounded_optional_string(input, "billing_address", 0, 10_000, true)
        }
        "browser.login.password-changed" => {
            required_uuid_value(input, "id")?;
            required_string(input, "password", 1, 10_000, false).map(|_| ())
        }
        "browser.fill.record" => {
            let kind = required_string(input, "item_kind", 1, 16, false)?;
            if !["login", "card", "identity", "secret", "ssh"].contains(&kind) {
                return Err(());
            }
            required_uuid_value(input, "item_id")?;
            required_string(input, "item_title", 1, 300, true)?;
            let origin = required_string(input, "origin", 1, 2_048, false)?;
            if !is_http_url(origin) {
                return Err(());
            }
            integer_in(input, "field_count", 1, 200)
        }
        "items.add" => validate_login(input, false),
        "items.update" => validate_login(input, true),
        "cards.add" => validate_card(input, false),
        "cards.update" => validate_card(input, true),
        "identities.add" => validate_identity_input(input, false),
        "identities.update" => validate_identity_input(input, true),
        "ssh.add" => validate_ssh(input, false),
        "ssh.update" => validate_ssh(input, true),
        "secrets.add" => validate_secret(input, false),
        "secrets.update" => validate_secret(input, true),
        "services.add" => validate_service(input, false),
        "services.update" => validate_service(input, true),
        "api-environments.add" => serde_json::from_value::<NewApiEnvironment>(input.clone())
            .map(|_| ())
            .map_err(|_| ()),
        "api-environments.update" => {
            serde_json::from_value::<ApiEnvironmentUpdate>(input.clone())
                .map(|_| ())
                .map_err(|_| ())
        }
        "_native.ssh.import" => array(input, "items", 1, 200).map(|_| ()),
        "_native.email.accounts" => Ok(()),
        "_native.email.account" | "_native.email.delete" => required_uuid_value(input, "id"),
        "_native.email.add" => validate_email_account(input, false),
        "_native.email.update" => validate_email_account(input, true),
        _ => Ok(()),
    }
}

fn validate_service(input: &Value, update: bool) -> Result<(), ()> {
    if update { required_uuid_value(input, "id")?; }
    required_string(input, "name", 1, 256, true)?;
    bounded_optional_string(input, "description", 0, 10_000, true)?;
    for tag in array(input, "tags", 0, 50)? { string_value(tag, 1, 128, true)?; }
    for site in array(input, "sites", 1, 20)? {
        let site = site.as_str().ok_or(())?;
        if site.len() > 2_048 || !is_http_url(site) { return Err(()); }
    }
    Ok(())
}

fn validate_email_account(input: &Value, update: bool) -> Result<(), ()> {
    if update {
        required_uuid_value(input, "id")?;
        bounded_optional_string(input, "credential", 1, 10_000, false)?;
    } else {
        required_string(input, "credential", 1, 10_000, false)?;
    }
    required_string(input, "label", 1, 128, true)?;
    required_string(input, "address", 3, 320, true)?;
    let provider = required_string(input, "provider", 1, 32, false)?;
    if ![
        "gmail",
        "outlook",
        "qq",
        "163",
        "126",
        "yeah",
        "icloud",
        "yahoo",
        "zoho",
        "fastmail",
        "custom-imap",
    ]
    .contains(&provider)
    {
        return Err(());
    }
    let auth_kind = required_string(input, "auth_kind", 1, 32, false)?;
    if !matches!(auth_kind, "oauth" | "app-password") {
        return Err(());
    }
    required_string(input, "imap_host", 1, 253, true)?;
    integer_in(input, "imap_port", 1, 65_535)?;
    input.get("use_tls").and_then(Value::as_bool).ok_or(())?;
    input.get("enabled").and_then(Value::as_bool).ok_or(())?;
    Ok(())
}

fn validate_login(input: &Value, update: bool) -> Result<(), ()> {
    if update {
        required_uuid_value(input, "id")?;
    }
    required_string(input, "title", 1, 256, true)?;
    required_string(input, "username", 0, 2_048, false)?;
    if update {
        bounded_optional_string(input, "password", 0, 10_000, false)?;
    } else {
        required_string(input, "password", 1, 10_000, false)?;
    }
    bounded_optional_string(input, "url", 0, 10_000, true)?;
    bounded_optional_string(input, "notes", 0, 10_000, true)?;
    bounded_optional_string(input, "folder", 0, 256, true)?;
    bounded_optional_string(input, "totp_secret", 1, 10_000, false)?;
    if let Some(codes) = input.get("recovery_codes").filter(|value| !value.is_null()) {
        let codes = codes.as_array().ok_or(())?;
        if codes.len() > 100 || (update && codes.is_empty()) {
            return Err(());
        }
        for code in codes {
            string_value(code, 1, 256, true)?;
        }
    } else if !update {
        return Err(());
    }
    let urls = array(input, "additional_urls", 0, 20)?;
    for url in urls {
        string_value(url, 1, 10_000, true)?;
    }
    let fields = array(input, "custom_fields", 0, 50)?;
    for field in fields {
        required_string(field, "label", 1, 256, true)?;
        required_string(field, "value", 0, 10_000, false)?;
    }
    Ok(())
}

fn validate_card(input: &Value, update: bool) -> Result<(), ()> {
    if update {
        required_uuid_value(input, "id")?;
    }
    required_string(input, "title", 1, 256, true)?;
    required_string(input, "cardholder_name", 1, 256, true)?;
    if update {
        bounded_optional_string(input, "card_number", 12, 32, true)?;
    } else {
        required_string(input, "card_number", 12, 32, true)?;
    }
    integer_in(input, "expiration_month", 1, 12)?;
    integer_in(input, "expiration_year", 1_000, 9_999)?;
    digit_string(input, "security_code", 3, 4, true)?;
    digit_string(input, "pin", 4, 12, true)?;
    for key in ["issuer", "network", "folder"] {
        bounded_optional_string(input, key, 0, 256, true)?;
    }
    for key in ["billing_address", "notes"] {
        bounded_optional_string(input, key, 0, 10_000, true)?;
    }
    Ok(())
}

fn validate_identity_input(input: &Value, update: bool) -> Result<(), ()> {
    if update {
        required_uuid_value(input, "id")?;
    }
    required_string(input, "title", 1, 256, true)?;
    for key in [
        "first_name",
        "middle_name",
        "last_name",
        "organization",
        "department",
        "job_title",
        "folder",
    ] {
        bounded_optional_string(input, key, 0, 256, true)?;
    }
    bounded_optional_string(input, "birth_date", 10, 10, false)?;
    bounded_optional_string(input, "website", 1, 2_048, false)?;
    bounded_optional_string(input, "notes", 0, 10_000, true)?;
    for key in ["emails", "phones"] {
        for entry in array(input, key, 0, 20)? {
            required_uuid_value(entry, "id")?;
            required_string(entry, "label", 0, 256, true)?;
            required_string(entry, "value", 1, 2_048, true)?;
        }
    }
    for entry in array(input, "addresses", 0, 20)? {
        required_uuid_value(entry, "id")?;
        required_string(entry, "label", 0, 256, true)?;
        required_string(entry, "address_line1", 1, 512, true)?;
        bounded_optional_string(entry, "address_line2", 0, 10_000, true)?;
        for key in ["city", "region", "postal_code", "country"] {
            bounded_optional_string(entry, key, 0, 256, true)?;
        }
        if let Some(code) = optional_string_value(entry, "country_code")?
            && (code.len() != 2 || !code.bytes().all(|byte| byte.is_ascii_alphabetic()))
        {
            return Err(());
        }
    }
    Ok(())
}

fn validate_ssh(input: &Value, update: bool) -> Result<(), ()> {
    if update {
        required_uuid_value(input, "id")?;
    }
    required_string(input, "title", 1, 256, true)?;
    bounded_optional_string(input, "host", 0, 256, true)?;
    integer_in(input, "port", 1, 65_535)?;
    required_string(input, "username", 0, 2_048, false)?;
    bounded_optional_string(input, "password", 1, 10_000, false)?;
    bounded_optional_string(input, "public_key", 1, 1_048_576, false)?;
    bounded_optional_string(input, "private_key", 1, 1_048_576, false)?;
    bounded_optional_string(input, "key_passphrase", 1, 10_000, false)?;
    bounded_optional_string(input, "notes", 0, 10_000, true)?;
    bounded_optional_string(input, "folder", 0, 256, true)?;
    let kind = required_string(input, "record_kind", 1, 16, false)?;
    let host = optional_string_value(input, "host")?;
    let username = required_string(input, "username", 0, 2_048, false)?;
    let has_public = optional_string_value(input, "public_key")?.is_some();
    let has_private = optional_string_value(input, "private_key")?.is_some();
    let has_passphrase = optional_string_value(input, "key_passphrase")?.is_some();
    match kind {
        "account"
            if host.is_none_or(|value| value.trim().is_empty()) || username.trim().is_empty() =>
        {
            Err(())
        }
        "account" if has_public || has_private || has_passphrase => Err(()),
        "account" => Ok(()),
        "key" if !update && !has_public && !has_private => Err(()),
        "key" if has_passphrase && !has_private => Err(()),
        "key" => Ok(()),
        _ => Err(()),
    }
}

fn validate_secret(input: &Value, update: bool) -> Result<(), ()> {
    if update {
        required_uuid_value(input, "id")?;
    }
    required_string(input, "title", 1, 256, true)?;
    let kind = required_string(input, "kind", 1, 64, false)?;
    if ![
        "api-key",
        "access-token",
        "authenticator-key",
        "client-secret",
        "webhook-secret",
        "database-credential",
        "recovery-codes",
        "certificate",
        "software-license",
        "identity-document",
        "secure-note",
        "crypto-wallet",
        "other",
    ]
    .contains(&kind)
    {
        return Err(());
    }
    if update {
        bounded_optional_string(input, "secret", 1, 10_000, false)?;
    } else {
        required_string(input, "secret", 1, 10_000, false)?;
    }
    for key in ["provider", "account", "environment", "folder"] {
        bounded_optional_string(input, key, 0, 256, true)?;
    }
    bounded_optional_string(input, "expires_at", 10, 10, false)?;
    bounded_optional_string(input, "website", 1, 2_048, false)?;
    bounded_optional_string(input, "notes", 0, 10_000, true)?;
    for scope in array(input, "scopes", 0, 50)? {
        string_value(scope, 1, 256, true)?;
    }
    Ok(())
}

fn member<'a>(input: &'a Value, key: &str) -> Result<&'a Value, ()> {
    input.as_object().and_then(|value| value.get(key)).ok_or(())
}

fn required_string<'a>(
    input: &'a Value,
    key: &str,
    minimum: usize,
    maximum: usize,
    trim: bool,
) -> Result<&'a str, ()> {
    let value = member(input, key)?.as_str().ok_or(())?;
    string_length(value, minimum, maximum, trim)?;
    Ok(value)
}

fn bounded_optional_string(
    input: &Value,
    key: &str,
    minimum: usize,
    maximum: usize,
    trim: bool,
) -> Result<(), ()> {
    let Some(value) = input.as_object().and_then(|object| object.get(key)) else {
        return Ok(());
    };
    if value.is_null() {
        return Ok(());
    }
    string_value(value, minimum, maximum, trim)
}

fn optional_string_value<'a>(input: &'a Value, key: &str) -> Result<Option<&'a str>, ()> {
    match input.as_object().and_then(|object| object.get(key)) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value)),
        _ => Err(()),
    }
}

fn string_value(value: &Value, minimum: usize, maximum: usize, trim: bool) -> Result<(), ()> {
    let value = value.as_str().ok_or(())?;
    string_length(value, minimum, maximum, trim)
}

fn string_length(value: &str, minimum: usize, maximum: usize, trim: bool) -> Result<(), ()> {
    let value = if trim { value.trim() } else { value };
    let length = value.encode_utf16().count();
    if (minimum..=maximum).contains(&length) {
        Ok(())
    } else {
        Err(())
    }
}

fn digit_string(
    input: &Value,
    key: &str,
    minimum: usize,
    maximum: usize,
    nullable: bool,
) -> Result<(), ()> {
    let Some(value) = input.as_object().and_then(|object| object.get(key)) else {
        return Err(());
    };
    if nullable && value.is_null() {
        return Ok(());
    }
    let value = value.as_str().ok_or(())?;
    string_length(value, minimum, maximum, false)?;
    value
        .bytes()
        .all(|byte| byte.is_ascii_digit())
        .then_some(())
        .ok_or(())
}

fn array<'a>(
    input: &'a Value,
    key: &str,
    minimum: usize,
    maximum: usize,
) -> Result<&'a [Value], ()> {
    let values = member(input, key)?.as_array().ok_or(())?;
    (minimum..=maximum)
        .contains(&values.len())
        .then_some(values.as_slice())
        .ok_or(())
}

fn integer_in(input: &Value, key: &str, minimum: u64, maximum: u64) -> Result<(), ()> {
    member(input, key)?
        .as_u64()
        .filter(|value| (minimum..=maximum).contains(value))
        .map(|_| ())
        .ok_or(())
}

fn required_uuid_value(input: &Value, key: &str) -> Result<(), ()> {
    Uuid::parse_str(required_string(input, key, 1, 64, false)?)
        .map(|_| ())
        .map_err(|_| ())
}

fn optional_uuid_value(input: &Value, key: &str) -> Result<(), ()> {
    optional_string_value(input, key)?
        .map(|value| Uuid::parse_str(value).map(|_| ()).map_err(|_| ()))
        .unwrap_or(Ok(()))
}

fn is_http_url(value: &str) -> bool {
    !value.chars().any(char::is_whitespace)
        && (value.starts_with("http://") || value.starts_with("https://"))
}

fn defaults(object: &mut Map<String, Value>, values: &[(&str, Value)]) {
    for (key, value) in values {
        object
            .entry((*key).to_owned())
            .or_insert_with(|| value.clone());
    }
}

fn is_mutation(operation: &str) -> bool {
    matches!(
        operation,
        "_native.record-unlock"
            | "_native.import.batch"
            | "_native.ssh.import"
            | "_native.email.add"
            | "_native.email.update"
            | "_native.email.delete"
            | "vault.change-password"
            | "browser.fill.record"
            | "items.add"
            | "items.update"
            | "items.delete"
            | "items.trash.restore"
            | "items.trash.purge"
            | "items.trash.empty"
            | "items.history.restore"
            | "items.history.clear"
            | "cards.add"
            | "cards.update"
            | "cards.delete"
            | "cards.trash.restore"
            | "cards.trash.purge"
            | "cards.trash.empty"
            | "cards.history.restore"
            | "cards.history.clear"
            | "identities.add"
            | "identities.update"
            | "identities.delete"
            | "identities.trash.restore"
            | "identities.trash.purge"
            | "identities.trash.empty"
            | "identities.history.restore"
            | "identities.history.clear"
            | "ssh.add"
            | "ssh.update"
            | "ssh.delete"
            | "ssh.trash.restore"
            | "ssh.trash.purge"
            | "ssh.trash.empty"
            | "ssh.history.restore"
            | "ssh.history.clear"
            | "secrets.add"
            | "secrets.update"
            | "secrets.delete"
            | "services.add"
            | "services.update"
            | "services.delete"
            | "services.link"
            | "services.unlink"
            | "services.move"
            | "services.merge"
            | "services.split"
            | "services.ignore-suggestion"
            | "services.trash.restore"
            | "services.trash.purge"
            | "services.trash.empty"
            | "services.history.restore"
            | "services.history.clear"
            | "services.aggregation.apply"
            | "services.aggregation.rollback"
            | "services.automatic-linking.update"
            | "api-environments.add"
            | "api-environments.update"
            | "api-environments.delete"
            | "api-environments.trash.restore"
            | "api-environments.trash.purge"
            | "api-environments.history.restore"
            | "api-environments.history.clear"
    )
}
