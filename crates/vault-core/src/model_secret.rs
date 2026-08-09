use super::*;

/// A developer/service credential whose value never appears in renderer-safe
/// summaries or details.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SecretItemKind {
    ApiKey,
    AccessToken,
    AuthenticatorKey,
    ClientSecret,
    WebhookSecret,
    DatabaseCredential,
    RecoveryCodes,
    Certificate,
    SoftwareLicense,
    IdentityDocument,
    SecureNote,
    CryptoWallet,
    #[default]
    Other,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct SecretItem {
    pub id: Uuid,
    pub title: String,
    pub kind: SecretItemKind,
    pub provider: Option<String>,
    pub account: Option<String>,
    pub secret: String,
    pub environment: Option<String>,
    pub scopes: Vec<String>,
    pub expires_at: Option<String>,
    pub website: Option<String>,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub favorite: bool,
    pub master_password_reprompt: bool,
}

impl fmt::Debug for SecretItem {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SecretItem")
            .field("id", &self.id)
            .field("title", &self.title)
            .field("kind", &self.kind)
            .field("provider", &self.provider)
            .field("account", &self.account)
            .field("secret", &"[REDACTED]")
            .field("environment", &self.environment)
            .field("scopes", &self.scopes)
            .field("expires_at", &self.expires_at)
            .field("website", &self.website)
            .field("notes", &self.notes.as_ref().map(|_| "[REDACTED]"))
            .field("folder", &self.folder)
            .field("favorite", &self.favorite)
            .field("master_password_reprompt", &self.master_password_reprompt)
            .finish()
    }
}

impl Zeroize for SecretItem {
    fn zeroize(&mut self) {
        self.title.zeroize();
        zeroize_option(&mut self.provider);
        zeroize_option(&mut self.account);
        self.secret.zeroize();
        zeroize_option(&mut self.environment);
        self.scopes.zeroize();
        zeroize_option(&mut self.expires_at);
        zeroize_option(&mut self.website);
        zeroize_option(&mut self.notes);
        zeroize_option(&mut self.folder);
    }
}
impl Drop for SecretItem {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct NewSecretItem {
    pub title: String,
    pub kind: SecretItemKind,
    pub provider: Option<String>,
    pub account: Option<String>,
    pub secret: String,
    pub environment: Option<String>,
    pub scopes: Vec<String>,
    pub expires_at: Option<String>,
    pub website: Option<String>,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub favorite: bool,
    pub master_password_reprompt: bool,
}

impl NewSecretItem {
    pub fn into_secret_item(mut self) -> Result<SecretItem, VaultError> {
        normalize_secret_item(&mut self);
        validate_secret_item(&self)?;
        Ok(SecretItem {
            id: Uuid::new_v4(),
            title: std::mem::take(&mut self.title),
            kind: self.kind.clone(),
            provider: self.provider.take(),
            account: self.account.take(),
            secret: std::mem::take(&mut self.secret),
            environment: self.environment.take(),
            scopes: std::mem::take(&mut self.scopes),
            expires_at: self.expires_at.take(),
            website: self.website.take(),
            notes: self.notes.take(),
            folder: self.folder.take(),
            favorite: self.favorite,
            master_password_reprompt: self.master_password_reprompt,
        })
    }
}
impl Zeroize for NewSecretItem {
    fn zeroize(&mut self) {
        self.title.zeroize();
        zeroize_option(&mut self.provider);
        zeroize_option(&mut self.account);
        self.secret.zeroize();
        zeroize_option(&mut self.environment);
        self.scopes.zeroize();
        zeroize_option(&mut self.expires_at);
        zeroize_option(&mut self.website);
        zeroize_option(&mut self.notes);
        zeroize_option(&mut self.folder);
    }
}
impl Drop for NewSecretItem {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct SecretItemUpdate {
    pub id: Uuid,
    pub title: String,
    pub kind: SecretItemKind,
    pub provider: Option<String>,
    pub account: Option<String>,
    /// None preserves the current secret so metadata edits do not expose it.
    pub secret: Option<String>,
    pub environment: Option<String>,
    pub scopes: Vec<String>,
    pub expires_at: Option<String>,
    pub website: Option<String>,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub favorite: bool,
    pub master_password_reprompt: bool,
}
impl Zeroize for SecretItemUpdate {
    fn zeroize(&mut self) {
        self.title.zeroize();
        zeroize_option(&mut self.provider);
        zeroize_option(&mut self.account);
        zeroize_option(&mut self.secret);
        zeroize_option(&mut self.environment);
        self.scopes.zeroize();
        zeroize_option(&mut self.expires_at);
        zeroize_option(&mut self.website);
        zeroize_option(&mut self.notes);
        zeroize_option(&mut self.folder);
    }
}
impl Drop for SecretItemUpdate {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SecretItemSummary {
    pub id: Uuid,
    pub title: String,
    pub kind: SecretItemKind,
    pub provider: Option<String>,
    pub account: Option<String>,
    pub environment: Option<String>,
    pub expires_at: Option<String>,
    pub website: Option<String>,
    pub notes: Option<String>,
    pub favorite: bool,
    pub master_password_reprompt: bool,
    #[serde(default)]
    pub is_passkey: bool,
    #[serde(default)]
    pub login_id: Option<Uuid>,
}
impl From<&SecretItem> for SecretItemSummary {
    fn from(item: &SecretItem) -> Self {
        let (is_passkey, login_id) = secret_passkey_presentation(item);
        Self {
            id: item.id,
            title: item.title.clone(),
            kind: item.kind.clone(),
            provider: item.provider.clone(),
            account: item.account.clone(),
            environment: item.environment.clone(),
            expires_at: item.expires_at.clone(),
            website: item.website.clone(),
            notes: item.notes.clone(),
            favorite: item.favorite,
            master_password_reprompt: item.master_password_reprompt,
            is_passkey,
            login_id,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SecretItemDetail {
    pub id: Uuid,
    pub title: String,
    pub kind: SecretItemKind,
    pub provider: Option<String>,
    pub account: Option<String>,
    pub environment: Option<String>,
    pub scopes: Vec<String>,
    pub expires_at: Option<String>,
    pub website: Option<String>,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub favorite: bool,
    pub master_password_reprompt: bool,
    #[serde(default)]
    pub is_passkey: bool,
    #[serde(default)]
    pub login_id: Option<Uuid>,
}
impl From<&SecretItem> for SecretItemDetail {
    fn from(item: &SecretItem) -> Self {
        let (is_passkey, login_id) = secret_passkey_presentation(item);
        Self {
            id: item.id,
            title: item.title.clone(),
            kind: item.kind.clone(),
            provider: item.provider.clone(),
            account: item.account.clone(),
            environment: item.environment.clone(),
            scopes: item
                .scopes
                .iter()
                .filter(|scope| !scope.starts_with(CREDENTIAL_LIFECYCLE_SCOPE_PREFIX))
                .cloned()
                .collect(),
            expires_at: item.expires_at.clone(),
            website: item.website.clone(),
            notes: item.notes.clone(),
            folder: item.folder.clone(),
            favorite: item.favorite,
            master_password_reprompt: item.master_password_reprompt,
            is_passkey,
            login_id,
        }
    }
}

const CREDENTIAL_LIFECYCLE_SCOPE_PREFIX: &str = "vaultmesh:credential-lifecycle:";

fn secret_passkey_presentation(item: &SecretItem) -> (bool, Option<Uuid>) {
    const PASSKEY_SCOPE: &str = "vaultmesh:passkey:v1";
    const LOGIN_SCOPE_PREFIX: &str = "login:";

    let is_passkey = item.kind == SecretItemKind::AuthenticatorKey
        && item.scopes.iter().any(|scope| scope == PASSKEY_SCOPE);
    let login_id = is_passkey
        .then(|| {
            item.scopes.iter().find_map(|scope| {
                scope
                    .strip_prefix(LOGIN_SCOPE_PREFIX)
                    .and_then(|value| Uuid::parse_str(value).ok())
            })
        })
        .flatten();
    (is_passkey, login_id)
}

fn normalize_secret_item(input: &mut NewSecretItem) {
    trim_string(&mut input.title);
    for value in [
        &mut input.provider,
        &mut input.account,
        &mut input.environment,
        &mut input.expires_at,
        &mut input.website,
        &mut input.notes,
        &mut input.folder,
    ] {
        trim_option(value);
    }
    for scope in &mut input.scopes {
        trim_string(scope);
    }
    input.scopes.retain(|scope| !scope.is_empty());
    input.scopes.sort();
    input.scopes.dedup();
}

fn validate_secret_item(input: &NewSecretItem) -> Result<(), VaultError> {
    if input.title.is_empty()
        || input.secret.is_empty()
        || input
            .expires_at
            .as_deref()
            .is_some_and(|value| !is_iso_date(value))
        || input
            .website
            .as_deref()
            .is_some_and(|value| !is_http_url(value))
        || input
            .scopes
            .iter()
            .any(|scope| scope.starts_with(CREDENTIAL_LIFECYCLE_SCOPE_PREFIX))
    {
        return Err(VaultError::InvalidSecretItem);
    }
    Ok(())
}
