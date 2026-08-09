use super::*;

/// A decrypted SSH credential. Authentication values remain inside the
/// unlocked core and are never included in renderer-facing summaries/details.
#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct SshCredentialItem {
    pub id: Uuid,
    pub title: String,
    pub host: Option<String>,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub public_key: Option<String>,
    pub private_key: Option<String>,
    pub key_passphrase: Option<String>,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub favorite: bool,
    pub master_password_reprompt: bool,
    /// Encrypted ownership metadata for an OpenSSH alias provisioned by the
    /// privileged desktop runtime. It is intentionally absent from
    /// renderer-safe summaries and details.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub managed_ssh_host: Option<ManagedSshHostBinding>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ManagedSshHostBinding {
    pub account_id: Uuid,
    pub alias: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub host_key_sha256: String,
}

impl Zeroize for ManagedSshHostBinding {
    fn zeroize(&mut self) {
        self.alias.zeroize();
        self.host.zeroize();
        self.username.zeroize();
        self.host_key_sha256.zeroize();
    }
}

impl fmt::Debug for SshCredentialItem {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SshCredentialItem")
            .field("id", &self.id)
            .field("title", &self.title)
            .field("host", &self.host)
            .field("port", &self.port)
            .field("username", &self.username)
            .field("password", &self.password.as_ref().map(|_| "[REDACTED]"))
            .field(
                "public_key",
                &self.public_key.as_ref().map(|_| "[REDACTED]"),
            )
            .field(
                "private_key",
                &self.private_key.as_ref().map(|_| "[REDACTED]"),
            )
            .field(
                "key_passphrase",
                &self.key_passphrase.as_ref().map(|_| "[REDACTED]"),
            )
            .field("notes", &self.notes.as_ref().map(|_| "[REDACTED]"))
            .field("folder", &self.folder)
            .field("favorite", &self.favorite)
            .field("master_password_reprompt", &self.master_password_reprompt)
            .field(
                "managed_ssh_host",
                &self.managed_ssh_host.as_ref().map(|_| "[REDACTED]"),
            )
            .finish()
    }
}

impl Zeroize for SshCredentialItem {
    fn zeroize(&mut self) {
        self.title.zeroize();
        zeroize_option(&mut self.host);
        self.username.zeroize();
        zeroize_option(&mut self.password);
        zeroize_option(&mut self.public_key);
        zeroize_option(&mut self.private_key);
        zeroize_option(&mut self.key_passphrase);
        zeroize_option(&mut self.notes);
        zeroize_option(&mut self.folder);
        if let Some(binding) = &mut self.managed_ssh_host {
            binding.zeroize();
        }
    }
}

impl Drop for SshCredentialItem {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct NewSshCredentialItem {
    pub title: String,
    pub host: Option<String>,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub public_key: Option<String>,
    pub private_key: Option<String>,
    pub key_passphrase: Option<String>,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub favorite: bool,
    pub master_password_reprompt: bool,
}

impl NewSshCredentialItem {
    pub fn into_ssh_credential(mut self) -> Result<SshCredentialItem, VaultError> {
        validate_ssh_fields(
            &self.title,
            self.port,
            self.password.as_deref(),
            self.public_key.as_deref(),
            self.private_key.as_deref(),
            self.key_passphrase.as_deref(),
        )?;
        Ok(SshCredentialItem {
            id: Uuid::new_v4(),
            title: std::mem::take(&mut self.title),
            host: self.host.take(),
            port: self.port,
            username: std::mem::take(&mut self.username),
            password: self.password.take(),
            public_key: self.public_key.take(),
            private_key: self.private_key.take(),
            key_passphrase: self.key_passphrase.take(),
            notes: self.notes.take(),
            folder: self.folder.take(),
            favorite: self.favorite,
            master_password_reprompt: self.master_password_reprompt,
            managed_ssh_host: None,
        })
    }
}

impl Zeroize for NewSshCredentialItem {
    fn zeroize(&mut self) {
        self.title.zeroize();
        zeroize_option(&mut self.host);
        self.username.zeroize();
        zeroize_option(&mut self.password);
        zeroize_option(&mut self.public_key);
        zeroize_option(&mut self.private_key);
        zeroize_option(&mut self.key_passphrase);
        zeroize_option(&mut self.notes);
        zeroize_option(&mut self.folder);
    }
}

impl Drop for NewSshCredentialItem {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct SshCredentialItemUpdate {
    pub id: Uuid,
    pub title: String,
    pub host: Option<String>,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub clear_password: bool,
    pub public_key: Option<String>,
    pub clear_public_key: bool,
    pub private_key: Option<String>,
    pub clear_private_key: bool,
    pub key_passphrase: Option<String>,
    pub clear_key_passphrase: bool,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub favorite: bool,
    pub master_password_reprompt: bool,
}

impl Zeroize for SshCredentialItemUpdate {
    fn zeroize(&mut self) {
        self.title.zeroize();
        zeroize_option(&mut self.host);
        self.username.zeroize();
        zeroize_option(&mut self.password);
        zeroize_option(&mut self.public_key);
        zeroize_option(&mut self.private_key);
        zeroize_option(&mut self.key_passphrase);
        zeroize_option(&mut self.notes);
        zeroize_option(&mut self.folder);
    }
}

impl Drop for SshCredentialItemUpdate {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SshCredentialRecordKind {
    Account,
    Key,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SshCredentialSummary {
    pub id: Uuid,
    pub title: String,
    pub host: Option<String>,
    pub port: u16,
    pub username: String,
    pub has_password: bool,
    pub has_public_key: bool,
    pub has_private_key: bool,
    pub has_key_passphrase: bool,
    pub key_algorithm: Option<String>,
    pub public_key_fingerprint: Option<String>,
    /// Safe display projection for a managed OpenSSH alias. All remaining
    /// binding fields stay inside the encrypted core item.
    pub managed_ssh_alias: Option<String>,
    pub notes: Option<String>,
    pub master_password_reprompt: bool,
    pub record_kind: SshCredentialRecordKind,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SshCredentialDetail {
    pub id: Uuid,
    pub title: String,
    pub host: Option<String>,
    pub port: u16,
    pub username: String,
    pub has_password: bool,
    pub has_public_key: bool,
    pub has_private_key: bool,
    pub has_key_passphrase: bool,
    pub key_algorithm: Option<String>,
    pub public_key_fingerprint: Option<String>,
    pub managed_ssh_alias: Option<String>,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub favorite: bool,
    pub master_password_reprompt: bool,
    pub record_kind: SshCredentialRecordKind,
}

impl From<&SshCredentialItem> for SshCredentialSummary {
    fn from(item: &SshCredentialItem) -> Self {
        let (key_algorithm, public_key_fingerprint) =
            public_key_metadata(item.public_key.as_deref());
        Self {
            id: item.id,
            title: item.title.clone(),
            host: item.host.clone(),
            port: item.port,
            username: item.username.clone(),
            has_password: item.password.is_some(),
            has_public_key: item.public_key.is_some(),
            has_private_key: item.private_key.is_some(),
            has_key_passphrase: item.key_passphrase.is_some(),
            key_algorithm,
            public_key_fingerprint,
            managed_ssh_alias: item
                .managed_ssh_host
                .as_ref()
                .map(|binding| binding.alias.clone()),
            notes: item.notes.clone(),
            master_password_reprompt: item.master_password_reprompt,
            record_kind: ssh_credential_record_kind(item),
        }
    }
}

impl From<&SshCredentialItem> for SshCredentialDetail {
    fn from(item: &SshCredentialItem) -> Self {
        let summary = SshCredentialSummary::from(item);
        Self {
            id: summary.id,
            title: summary.title,
            host: summary.host,
            port: summary.port,
            username: summary.username,
            has_password: summary.has_password,
            has_public_key: summary.has_public_key,
            has_private_key: summary.has_private_key,
            has_key_passphrase: summary.has_key_passphrase,
            key_algorithm: summary.key_algorithm,
            public_key_fingerprint: summary.public_key_fingerprint,
            managed_ssh_alias: summary.managed_ssh_alias,
            notes: summary.notes,
            folder: item.folder.clone(),
            favorite: item.favorite,
            master_password_reprompt: summary.master_password_reprompt,
            record_kind: summary.record_kind,
        }
    }
}

fn ssh_credential_record_kind(item: &SshCredentialItem) -> SshCredentialRecordKind {
    if item
        .host
        .as_deref()
        .is_some_and(|host| !host.trim().is_empty())
        && !item.username.trim().is_empty()
    {
        SshCredentialRecordKind::Account
    } else {
        SshCredentialRecordKind::Key
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TrashedSshCredential {
    pub trash_id: Uuid,
    pub deleted_at: u64,
    pub item: SshCredentialItem,
}

impl Zeroize for TrashedSshCredential {
    fn zeroize(&mut self) {
        self.item.zeroize();
    }
}
impl Drop for TrashedSshCredential {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SshCredentialRevision {
    pub revision_id: Uuid,
    pub item_id: Uuid,
    pub saved_at: u64,
    pub item: SshCredentialItem,
}

impl Zeroize for SshCredentialRevision {
    fn zeroize(&mut self) {
        self.item.zeroize();
    }
}
impl Drop for SshCredentialRevision {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SshCredentialTrashSummary {
    pub trash_id: Uuid,
    pub item_id: Uuid,
    pub title: String,
    pub host: Option<String>,
    pub deleted_at: u64,
}

impl From<&TrashedSshCredential> for SshCredentialTrashSummary {
    fn from(entry: &TrashedSshCredential) -> Self {
        Self {
            trash_id: entry.trash_id,
            item_id: entry.item.id,
            title: entry.item.title.clone(),
            host: entry.item.host.clone(),
            deleted_at: entry.deleted_at,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SshCredentialRevisionSummary {
    pub revision_id: Uuid,
    pub item_id: Uuid,
    pub title: String,
    pub host: Option<String>,
    pub saved_at: u64,
}

impl From<&SshCredentialRevision> for SshCredentialRevisionSummary {
    fn from(revision: &SshCredentialRevision) -> Self {
        Self {
            revision_id: revision.revision_id,
            item_id: revision.item_id,
            title: revision.item.title.clone(),
            host: revision.item.host.clone(),
            saved_at: revision.saved_at,
        }
    }
}
