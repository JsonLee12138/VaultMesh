use serde::Serialize;
use uuid::Uuid;
use vaultmesh_core::{VaultError, VaultSession};

use crate::{
    VAULTMESH_STATUS_CORE_ERROR, VAULTMESH_STATUS_INVALID_ARGUMENT, VAULTMESH_STATUS_OK,
    VaultmeshBuffer, VaultmeshBytes, VaultmeshStatus, VaultmeshVault,
    buffer::initialize_out_buffer,
    status::{check_abi, ffi_boundary},
    vault::map_core_error,
};

pub const VAULTMESH_ITEM_METADATA_SCHEMA_VERSION: u32 = 1;
pub const VAULTMESH_ITEM_KIND_LOGIN: u32 = 1;
pub const VAULTMESH_ITEM_KIND_PAYMENT_CARD: u32 = 2;
pub const VAULTMESH_ITEM_KIND_IDENTITY: u32 = 3;
pub const VAULTMESH_ITEM_KIND_SSH_CREDENTIAL: u32 = 4;
pub const VAULTMESH_ITEM_KIND_SECRET: u32 = 5;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
enum NativeItemKind {
    Login,
    PaymentCard,
    Identity,
    SshCredential,
    Secret,
}

impl NativeItemKind {
    fn parse(value: u32) -> Result<Self, VaultmeshStatus> {
        match value {
            VAULTMESH_ITEM_KIND_LOGIN => Ok(Self::Login),
            VAULTMESH_ITEM_KIND_PAYMENT_CARD => Ok(Self::PaymentCard),
            VAULTMESH_ITEM_KIND_IDENTITY => Ok(Self::Identity),
            VAULTMESH_ITEM_KIND_SSH_CREDENTIAL => Ok(Self::SshCredential),
            VAULTMESH_ITEM_KIND_SECRET => Ok(Self::Secret),
            _ => Err(VAULTMESH_STATUS_INVALID_ARGUMENT),
        }
    }

    fn sort_key(self) -> u8 {
        match self {
            Self::Login => 0,
            Self::PaymentCard => 1,
            Self::Identity => 2,
            Self::SshCredential => 3,
            Self::Secret => 4,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeItemSummary {
    id: String,
    kind: NativeItemKind,
    title: String,
    subtitle: Option<String>,
    favorite: bool,
    master_password_reprompt: bool,
    protected_fields: Vec<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    secret_kind: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeMetadataField {
    key: &'static str,
    label: Option<String>,
    value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    entry_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    preferred: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    address: Option<NativeAddressMetadata>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeAddressMetadata {
    address_line1: String,
    address_line2: Option<String>,
    city: Option<String>,
    region: Option<String>,
    postal_code: Option<String>,
    country_code: Option<String>,
    country: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeItemDetail {
    summary: NativeItemSummary,
    metadata: Vec<NativeMetadataField>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeItemListResponse {
    schema_version: u32,
    items: Vec<NativeItemSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeItemDetailResponse {
    schema_version: u32,
    item: NativeItemDetail,
}

fn nonempty(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

fn combined(values: &[Option<&str>], separator: &str) -> Option<String> {
    nonempty(
        values
            .iter()
            .flatten()
            .filter(|value| !value.is_empty())
            .copied()
            .collect::<Vec<_>>()
            .join(separator),
    )
}

fn push_value(fields: &mut Vec<NativeMetadataField>, key: &'static str, value: String) {
    if !value.is_empty() {
        fields.push(NativeMetadataField {
            key,
            label: None,
            value,
            entry_id: None,
            preferred: None,
            address: None,
        });
    }
}

fn push_optional(fields: &mut Vec<NativeMetadataField>, key: &'static str, value: Option<String>) {
    if let Some(value) = value {
        push_value(fields, key, value);
    }
}

fn push_identity_value(
    fields: &mut Vec<NativeMetadataField>,
    key: &'static str,
    id: Uuid,
    label: String,
    value: String,
    preferred: bool,
) {
    if !value.is_empty() {
        fields.push(NativeMetadataField {
            key,
            label: nonempty(label),
            value,
            entry_id: Some(id.to_string()),
            preferred: Some(preferred),
            address: None,
        });
    }
}

fn login_summary(session: &VaultSession, id: Uuid) -> Result<NativeItemSummary, VaultError> {
    let item = session.item_detail(id)?;
    Ok(NativeItemSummary {
        id: item.id.to_string(),
        kind: NativeItemKind::Login,
        title: item.title,
        subtitle: nonempty(item.username.clone()).or(item.url.clone()),
        favorite: item.favorite,
        master_password_reprompt: item.master_password_reprompt,
        protected_fields: if item.has_totp_secret {
            vec!["password", "totp"]
        } else {
            vec!["password"]
        },
        secret_kind: None,
    })
}

fn card_summary(session: &VaultSession, id: Uuid) -> Result<NativeItemSummary, VaultError> {
    let item = session.card_detail(id)?;
    let mut protected_fields = vec!["cardNumber"];
    if item.has_security_code {
        protected_fields.push("securityCode");
    }
    if item.has_pin {
        protected_fields.push("pin");
    }
    Ok(NativeItemSummary {
        id: item.id.to_string(),
        kind: NativeItemKind::PaymentCard,
        title: item.title,
        subtitle: nonempty(item.masked_number),
        favorite: item.favorite,
        master_password_reprompt: item.master_password_reprompt,
        protected_fields,
        secret_kind: None,
    })
}

fn identity_summary(session: &VaultSession, id: Uuid) -> Result<NativeItemSummary, VaultError> {
    let item = session.identity_detail(id)?;
    let display_name = combined(
        &[
            item.first_name.as_deref(),
            item.middle_name.as_deref(),
            item.last_name.as_deref(),
        ],
        " ",
    );
    Ok(NativeItemSummary {
        id: item.id.to_string(),
        kind: NativeItemKind::Identity,
        title: item.title,
        subtitle: display_name.or(item.organization),
        favorite: item.favorite,
        master_password_reprompt: false,
        protected_fields: Vec::new(),
        secret_kind: None,
    })
}

fn ssh_summary(session: &VaultSession, id: Uuid) -> Result<NativeItemSummary, VaultError> {
    let item = session.ssh_credential_detail(id)?;
    let mut protected_fields = Vec::new();
    if item.has_password {
        protected_fields.push("password");
    }
    if item.has_public_key {
        protected_fields.push("publicKey");
    }
    if item.has_private_key {
        protected_fields.push("privateKey");
    }
    if item.has_key_passphrase {
        protected_fields.push("keyPassphrase");
    }
    let subtitle = item.host.as_deref().map_or_else(
        || nonempty(item.username.clone()),
        |host| {
            nonempty(if item.username.is_empty() {
                host.to_owned()
            } else {
                format!("{}@{host}", item.username)
            })
        },
    );
    Ok(NativeItemSummary {
        id: item.id.to_string(),
        kind: NativeItemKind::SshCredential,
        title: item.title,
        subtitle,
        favorite: item.favorite,
        master_password_reprompt: item.master_password_reprompt,
        protected_fields,
        secret_kind: None,
    })
}

fn secret_summary(session: &VaultSession, id: Uuid) -> Result<NativeItemSummary, VaultError> {
    let item = session.secret_detail(id)?;
    let subtitle = combined(&[item.provider.as_deref(), item.account.as_deref()], " · ");
    let secret_kind = serde_json::to_value(&item.kind)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned));
    Ok(NativeItemSummary {
        id: item.id.to_string(),
        kind: NativeItemKind::Secret,
        title: item.title,
        subtitle,
        favorite: item.favorite,
        master_password_reprompt: item.master_password_reprompt,
        protected_fields: vec!["secretValue"],
        secret_kind,
    })
}

fn list_items(session: &VaultSession) -> Result<Vec<NativeItemSummary>, VaultError> {
    let mut items = Vec::new();
    for item in session.list_items()? {
        items.push(login_summary(session, item.id)?);
    }
    for item in session.list_cards()? {
        items.push(card_summary(session, item.id)?);
    }
    for item in session.list_identities()? {
        items.push(identity_summary(session, item.id)?);
    }
    for item in session.list_ssh_credentials()? {
        items.push(ssh_summary(session, item.id)?);
    }
    for item in session.list_secrets()? {
        items.push(secret_summary(session, item.id)?);
    }
    items.sort_by(|left, right| {
        left.kind
            .sort_key()
            .cmp(&right.kind.sort_key())
            .then_with(|| left.title.to_lowercase().cmp(&right.title.to_lowercase()))
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(items)
}

fn login_detail(session: &VaultSession, id: Uuid) -> Result<NativeItemDetail, VaultError> {
    let item = session.item_detail(id)?;
    let summary = login_summary(session, id)?;
    let mut metadata = Vec::new();
    push_value(&mut metadata, "username", item.username);
    push_optional(&mut metadata, "url", item.url);
    for url in item.additional_urls {
        push_value(&mut metadata, "additionalUrl", url);
    }
    push_optional(&mut metadata, "notes", item.notes);
    push_optional(&mut metadata, "folder", item.folder);
    push_value(
        &mut metadata,
        "autofillOnPageLoad",
        item.autofill_on_page_load.to_string(),
    );
    // Login custom fields are intentionally absent until the core model can
    // classify each field as ordinary metadata or protected value.
    Ok(NativeItemDetail { summary, metadata })
}

fn card_detail(session: &VaultSession, id: Uuid) -> Result<NativeItemDetail, VaultError> {
    let item = session.card_detail(id)?;
    let summary = card_summary(session, id)?;
    let mut metadata = Vec::new();
    push_value(&mut metadata, "cardholderName", item.cardholder_name);
    push_value(&mut metadata, "maskedNumber", item.masked_number);
    push_value(
        &mut metadata,
        "expiration",
        format!("{:02}/{:04}", item.expiration_month, item.expiration_year),
    );
    push_optional(&mut metadata, "issuer", item.issuer);
    push_optional(&mut metadata, "network", item.network);
    push_optional(&mut metadata, "billingAddress", item.billing_address);
    push_optional(&mut metadata, "notes", item.notes);
    push_optional(&mut metadata, "folder", item.folder);
    Ok(NativeItemDetail { summary, metadata })
}

fn identity_detail(session: &VaultSession, id: Uuid) -> Result<NativeItemDetail, VaultError> {
    let item = session.identity_detail(id)?;
    let summary = identity_summary(session, id)?;
    let mut metadata = Vec::new();
    push_optional(&mut metadata, "firstName", item.first_name);
    push_optional(&mut metadata, "middleName", item.middle_name);
    push_optional(&mut metadata, "lastName", item.last_name);
    push_optional(&mut metadata, "birthDate", item.birth_date);
    for email in &item.emails {
        push_identity_value(
            &mut metadata,
            "email",
            email.id,
            email.label.clone(),
            email.value.clone(),
            email.preferred,
        );
    }
    for phone in &item.phones {
        push_identity_value(
            &mut metadata,
            "phone",
            phone.id,
            phone.label.clone(),
            phone.value.clone(),
            phone.preferred,
        );
    }
    for address in &item.addresses {
        let value = [
            Some(address.address_line1.as_str()),
            address.address_line2.as_deref(),
            address.city.as_deref(),
            address.region.as_deref(),
            address.postal_code.as_deref(),
            address.country.as_deref(),
        ]
        .into_iter()
        .flatten()
        .filter(|value| !value.is_empty())
        .collect::<Vec<&str>>()
        .join(", ");
        if !value.is_empty() {
            metadata.push(NativeMetadataField {
                key: "address",
                label: nonempty(address.label.clone()),
                value,
                entry_id: Some(address.id.to_string()),
                preferred: Some(address.preferred),
                address: Some(NativeAddressMetadata {
                    address_line1: address.address_line1.clone(),
                    address_line2: address.address_line2.clone(),
                    city: address.city.clone(),
                    region: address.region.clone(),
                    postal_code: address.postal_code.clone(),
                    country_code: address.country_code.clone(),
                    country: address.country.clone(),
                }),
            });
        }
    }
    push_optional(&mut metadata, "organization", item.organization);
    push_optional(&mut metadata, "department", item.department);
    push_optional(&mut metadata, "jobTitle", item.job_title);
    push_optional(&mut metadata, "website", item.website);
    push_optional(&mut metadata, "notes", item.notes);
    push_optional(&mut metadata, "folder", item.folder);
    Ok(NativeItemDetail { summary, metadata })
}

fn ssh_detail(session: &VaultSession, id: Uuid) -> Result<NativeItemDetail, VaultError> {
    let item = session.ssh_credential_detail(id)?;
    let summary = ssh_summary(session, id)?;
    let mut metadata = Vec::new();
    push_optional(&mut metadata, "host", item.host);
    push_value(&mut metadata, "port", item.port.to_string());
    push_value(&mut metadata, "username", item.username);
    push_optional(&mut metadata, "keyAlgorithm", item.key_algorithm);
    push_optional(
        &mut metadata,
        "publicKeyFingerprint",
        item.public_key_fingerprint,
    );
    push_optional(&mut metadata, "notes", item.notes);
    push_optional(&mut metadata, "folder", item.folder);
    Ok(NativeItemDetail { summary, metadata })
}

fn secret_detail(session: &VaultSession, id: Uuid) -> Result<NativeItemDetail, VaultError> {
    let item = session.secret_detail(id)?;
    let summary = secret_summary(session, id)?;
    let mut metadata = Vec::new();
    push_optional(&mut metadata, "provider", item.provider);
    push_optional(&mut metadata, "account", item.account);
    push_optional(&mut metadata, "environment", item.environment);
    for scope in item.scopes {
        push_value(&mut metadata, "scope", scope);
    }
    push_optional(&mut metadata, "expiresAt", item.expires_at);
    push_optional(&mut metadata, "website", item.website);
    push_optional(&mut metadata, "notes", item.notes);
    push_optional(&mut metadata, "folder", item.folder);
    Ok(NativeItemDetail { summary, metadata })
}

fn detail(
    session: &VaultSession,
    kind: NativeItemKind,
    id: Uuid,
) -> Result<NativeItemDetail, VaultError> {
    match kind {
        NativeItemKind::Login => login_detail(session, id),
        NativeItemKind::PaymentCard => card_detail(session, id),
        NativeItemKind::Identity => identity_detail(session, id),
        NativeItemKind::SshCredential => ssh_detail(session, id),
        NativeItemKind::Secret => secret_detail(session, id),
    }
}

fn serialize_into<T: Serialize>(value: &T, out_json: *mut VaultmeshBuffer) -> VaultmeshStatus {
    let bytes = match serde_json::to_vec(value) {
        Ok(bytes) => bytes,
        Err(_) => return VAULTMESH_STATUS_CORE_ERROR,
    };
    debug_assert!(!bytes.is_empty());
    // SAFETY: every exported caller validates writable empty storage first.
    unsafe { *out_json = VaultmeshBuffer::from_vec(bytes) };
    VAULTMESH_STATUS_OK
}

/// Returns all active item summaries as schema-versioned, protected-value-free
/// UTF-8 JSON in a Rust-owned buffer.
///
/// # Safety
///
/// `vault` must be a live handle. `out_json` must point to a writable empty
/// buffer that the caller later passes to `vaultmesh_buffer_destroy` on success.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn vaultmesh_items_list(
    abi_version: u32,
    vault: *const VaultmeshVault,
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
        // SAFETY: the caller contract requires a live opaque handle.
        let vault = unsafe { &*vault };
        let items = match list_items(&vault.session) {
            Ok(items) => items,
            Err(error) => return map_core_error(error),
        };
        serialize_into(
            &NativeItemListResponse {
                schema_version: VAULTMESH_ITEM_METADATA_SCHEMA_VERSION,
                items,
            },
            out_json,
        )
    })
}

/// Returns one active item's safe detail as schema-versioned UTF-8 JSON.
///
/// # Safety
///
/// `vault` must be a live handle, `item_id` must remain readable for the call,
/// and `out_json` must point to a writable empty buffer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn vaultmesh_item_detail(
    abi_version: u32,
    vault: *const VaultmeshVault,
    item_kind: u32,
    item_id: VaultmeshBytes,
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
        let kind = match NativeItemKind::parse(item_kind) {
            Ok(kind) => kind,
            Err(status) => return status,
        };
        // SAFETY: byte-view validity is part of the exported operation contract.
        let id = match unsafe { item_id.as_utf8() }
            .ok()
            .and_then(|value| Uuid::parse_str(value).ok())
        {
            Some(id) => id,
            None => return VAULTMESH_STATUS_INVALID_ARGUMENT,
        };
        // SAFETY: the caller contract requires a live opaque handle.
        let vault = unsafe { &*vault };
        let item = match detail(&vault.session, kind, id) {
            Ok(item) => item,
            Err(error) => return map_core_error(error),
        };
        serialize_into(
            &NativeItemDetailResponse {
                schema_version: VAULTMESH_ITEM_METADATA_SCHEMA_VERSION,
                item,
            },
            out_json,
        )
    })
}
