use super::*;

/// A user-defined label/value pair stored with a login item.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct LoginCustomField {
    pub label: String,
    pub value: String,
}

impl Zeroize for LoginCustomField {
    fn zeroize(&mut self) {
        self.label.zeroize();
        self.value.zeroize();
    }
}

/// A decrypted credential. This type only lives inside an unlocked session;
/// renderer-facing lists use `LoginItemSummary` instead.
#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct LoginItem {
    pub id: Uuid,
    pub title: String,
    pub username: String,
    pub password: String,
    pub url: Option<String>,
    pub notes: Option<String>,
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub totp_secret: Option<String>,
    #[serde(default)]
    pub recovery_codes: Vec<String>,
    #[serde(default)]
    pub additional_urls: Vec<String>,
    #[serde(default)]
    pub autofill_on_page_load: bool,
    #[serde(default)]
    pub master_password_reprompt: bool,
    #[serde(default)]
    pub custom_fields: Vec<LoginCustomField>,
    /// Unix seconds when the password was last set. `0` means an older vault
    /// did not record this metadata, and must not be treated as stale.
    #[serde(default)]
    pub password_changed_at: u64,
}

impl LoginItem {
    pub fn new(title: String, username: String, password: String) -> Self {
        Self {
            id: Uuid::new_v4(),
            title,
            username,
            password,
            url: None,
            notes: None,
            folder: None,
            favorite: false,
            totp_secret: None,
            recovery_codes: Vec::new(),
            additional_urls: Vec::new(),
            autofill_on_page_load: true,
            master_password_reprompt: false,
            custom_fields: Vec::new(),
            password_changed_at: 0,
        }
    }
}

impl fmt::Debug for LoginItem {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LoginItem")
            .field("id", &self.id)
            .field("title", &self.title)
            .field("username", &self.username)
            .field("password", &"[REDACTED]")
            .field("url", &self.url)
            .field("notes", &self.notes.as_ref().map(|_| "[REDACTED]"))
            .field("folder", &self.folder)
            .field("favorite", &self.favorite)
            .field(
                "totp_secret",
                &self.totp_secret.as_ref().map(|_| "[REDACTED]"),
            )
            .field("recovery_codes", &self.recovery_codes.len())
            .field("additional_urls", &self.additional_urls)
            .field("autofill_on_page_load", &self.autofill_on_page_load)
            .field("master_password_reprompt", &self.master_password_reprompt)
            .field("custom_fields", &self.custom_fields.len())
            .field("password_changed_at", &self.password_changed_at)
            .finish()
    }
}

impl Zeroize for LoginItem {
    fn zeroize(&mut self) {
        self.title.zeroize();
        self.username.zeroize();
        self.password.zeroize();
        zeroize_option(&mut self.url);
        zeroize_option(&mut self.notes);
        zeroize_option(&mut self.folder);
        zeroize_option(&mut self.totp_secret);
        self.recovery_codes.zeroize();
        self.additional_urls.zeroize();
        self.custom_fields.zeroize();
    }
}

impl Drop for LoginItem {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct NewLoginItem {
    pub title: String,
    pub username: String,
    pub password: String,
    pub url: Option<String>,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub favorite: bool,
    pub totp_secret: Option<String>,
    #[serde(default)]
    pub recovery_codes: Vec<String>,
    pub additional_urls: Vec<String>,
    pub autofill_on_page_load: bool,
    pub master_password_reprompt: bool,
    pub custom_fields: Vec<LoginCustomField>,
}

impl NewLoginItem {
    pub fn into_login_item(mut self) -> Result<LoginItem, VaultError> {
        let totp_secret = match self.totp_secret.as_deref() {
            Some(secret) => Some(normalize_totp_secret(secret)?),
            None => None,
        };
        validate_recovery_codes(&self.recovery_codes)?;
        Ok(LoginItem {
            id: Uuid::new_v4(),
            title: std::mem::take(&mut self.title),
            username: std::mem::take(&mut self.username),
            password: std::mem::take(&mut self.password),
            url: self.url.take(),
            notes: self.notes.take(),
            folder: self.folder.take(),
            favorite: self.favorite,
            totp_secret,
            recovery_codes: std::mem::take(&mut self.recovery_codes),
            additional_urls: std::mem::take(&mut self.additional_urls),
            autofill_on_page_load: self.autofill_on_page_load,
            master_password_reprompt: self.master_password_reprompt,
            custom_fields: std::mem::take(&mut self.custom_fields),
            password_changed_at: 0,
        })
    }
}

impl Zeroize for NewLoginItem {
    fn zeroize(&mut self) {
        self.title.zeroize();
        self.username.zeroize();
        self.password.zeroize();
        zeroize_option(&mut self.url);
        zeroize_option(&mut self.notes);
        zeroize_option(&mut self.folder);
        zeroize_option(&mut self.totp_secret);
        self.recovery_codes.zeroize();
        self.additional_urls.zeroize();
        self.custom_fields.zeroize();
    }
}

impl Drop for NewLoginItem {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct LoginItemUpdate {
    pub id: Uuid,
    pub title: String,
    pub username: String,
    /// `None` preserves the existing password so editing metadata never needs
    /// to load that password into renderer memory.
    pub password: Option<String>,
    pub url: Option<String>,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub favorite: bool,
    /// `None` preserves the existing authenticator secret; use
    /// `clear_totp_secret` to remove it.
    pub totp_secret: Option<String>,
    pub clear_totp_secret: bool,
    /// `None` preserves the existing recovery codes; use
    /// `clear_recovery_codes` to remove them.
    pub recovery_codes: Option<Vec<String>>,
    pub clear_recovery_codes: bool,
    pub additional_urls: Vec<String>,
    pub autofill_on_page_load: bool,
    pub master_password_reprompt: bool,
    pub custom_fields: Vec<LoginCustomField>,
}

impl Zeroize for LoginItemUpdate {
    fn zeroize(&mut self) {
        self.title.zeroize();
        self.username.zeroize();
        zeroize_option(&mut self.password);
        zeroize_option(&mut self.url);
        zeroize_option(&mut self.notes);
        zeroize_option(&mut self.folder);
        zeroize_option(&mut self.totp_secret);
        if let Some(codes) = &mut self.recovery_codes {
            codes.zeroize();
        }
        self.additional_urls.zeroize();
        self.custom_fields.zeroize();
    }
}

impl Drop for LoginItemUpdate {
    fn drop(&mut self) {
        self.zeroize();
    }
}
