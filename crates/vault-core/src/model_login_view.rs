use super::*;

/// Renderer-safe item metadata. Passwords are intentionally absent.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct LoginItemSummary {
    pub id: Uuid,
    pub title: String,
    pub username: String,
    pub url: Option<String>,
    pub notes: Option<String>,
    pub has_password: bool,
    pub has_totp_secret: bool,
    pub has_recovery_codes: bool,
    pub autofill_on_page_load: bool,
    pub master_password_reprompt: bool,
}

/// Data needed for editing a login, deliberately excluding its password and
/// authenticator secret. The secret may be replaced but is never read back.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct LoginItemDetail {
    pub id: Uuid,
    pub title: String,
    pub username: String,
    pub url: Option<String>,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub favorite: bool,
    pub has_totp_secret: bool,
    pub has_recovery_codes: bool,
    pub additional_urls: Vec<String>,
    pub autofill_on_page_load: bool,
    pub master_password_reprompt: bool,
    pub custom_fields: Vec<LoginCustomField>,
}

impl From<&LoginItem> for LoginItemSummary {
    fn from(item: &LoginItem) -> Self {
        Self {
            id: item.id,
            title: item.title.clone(),
            username: item.username.clone(),
            url: item.url.clone(),
            notes: item.notes.clone(),
            has_password: !item.password.is_empty(),
            has_totp_secret: item.totp_secret.is_some(),
            has_recovery_codes: !item.recovery_codes.is_empty(),
            autofill_on_page_load: item.autofill_on_page_load,
            master_password_reprompt: item.master_password_reprompt,
        }
    }
}

impl From<&LoginItem> for LoginItemDetail {
    fn from(item: &LoginItem) -> Self {
        Self {
            id: item.id,
            title: item.title.clone(),
            username: item.username.clone(),
            url: item.url.clone(),
            notes: item.notes.clone(),
            folder: item.folder.clone(),
            favorite: item.favorite,
            has_totp_secret: item.totp_secret.is_some(),
            has_recovery_codes: !item.recovery_codes.is_empty(),
            additional_urls: item.additional_urls.clone(),
            autofill_on_page_load: item.autofill_on_page_load,
            master_password_reprompt: item.master_password_reprompt,
            custom_fields: item.custom_fields.clone(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TrashedLoginItem {
    pub trash_id: Uuid,
    pub deleted_at: u64,
    pub item: LoginItem,
}

impl Zeroize for TrashedLoginItem {
    fn zeroize(&mut self) {
        self.item.zeroize();
    }
}

impl Drop for TrashedLoginItem {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct LoginItemRevision {
    pub revision_id: Uuid,
    pub item_id: Uuid,
    pub saved_at: u64,
    pub item: LoginItem,
}

impl Zeroize for LoginItemRevision {
    fn zeroize(&mut self) {
        self.item.zeroize();
    }
}

impl Drop for LoginItemRevision {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TrashItemSummary {
    pub trash_id: Uuid,
    pub item_id: Uuid,
    pub title: String,
    pub username: String,
    pub deleted_at: u64,
}

impl From<&TrashedLoginItem> for TrashItemSummary {
    fn from(entry: &TrashedLoginItem) -> Self {
        Self {
            trash_id: entry.trash_id,
            item_id: entry.item.id,
            title: entry.item.title.clone(),
            username: entry.item.username.clone(),
            deleted_at: entry.deleted_at,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct LoginItemRevisionSummary {
    pub revision_id: Uuid,
    pub item_id: Uuid,
    pub title: String,
    pub username: String,
    pub saved_at: u64,
}

impl From<&LoginItemRevision> for LoginItemRevisionSummary {
    fn from(revision: &LoginItemRevision) -> Self {
        Self {
            revision_id: revision.revision_id,
            item_id: revision.item_id,
            title: revision.item.title.clone(),
            username: revision.item.username.clone(),
            saved_at: revision.saved_at,
        }
    }
}
