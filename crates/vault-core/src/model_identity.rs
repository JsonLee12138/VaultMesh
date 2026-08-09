use super::*;

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct PasswordHealthReport {
    pub weak_item_ids: Vec<Uuid>,
    pub reused_item_ids: Vec<Uuid>,
    pub old_item_ids: Vec<Uuid>,
    pub score: u32,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct IdentityValue {
    pub id: Uuid,
    pub label: String,
    pub value: String,
    pub preferred: bool,
}

impl Zeroize for IdentityValue {
    fn zeroize(&mut self) {
        self.label.zeroize();
        self.value.zeroize();
    }
}
impl Drop for IdentityValue {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct PostalAddress {
    pub id: Uuid,
    pub label: String,
    pub address_line1: String,
    pub address_line2: Option<String>,
    pub city: Option<String>,
    pub region: Option<String>,
    pub postal_code: Option<String>,
    pub country_code: Option<String>,
    pub country: Option<String>,
    pub preferred: bool,
}

impl Zeroize for PostalAddress {
    fn zeroize(&mut self) {
        self.label.zeroize();
        self.address_line1.zeroize();
        zeroize_option(&mut self.address_line2);
        zeroize_option(&mut self.city);
        zeroize_option(&mut self.region);
        zeroize_option(&mut self.postal_code);
        zeroize_option(&mut self.country_code);
        zeroize_option(&mut self.country);
    }
}
impl Drop for PostalAddress {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct IdentityItem {
    pub id: Uuid,
    pub title: String,
    pub first_name: Option<String>,
    pub middle_name: Option<String>,
    pub last_name: Option<String>,
    pub birth_date: Option<String>,
    pub emails: Vec<IdentityValue>,
    pub phones: Vec<IdentityValue>,
    pub addresses: Vec<PostalAddress>,
    pub organization: Option<String>,
    pub department: Option<String>,
    pub job_title: Option<String>,
    pub website: Option<String>,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub favorite: bool,
}

impl fmt::Debug for IdentityItem {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("IdentityItem")
            .field("id", &self.id)
            .field("title", &self.title)
            .field("emails", &self.emails.len())
            .field("phones", &self.phones.len())
            .field("addresses", &self.addresses.len())
            .field("favorite", &self.favorite)
            .finish()
    }
}

impl Zeroize for IdentityItem {
    fn zeroize(&mut self) {
        self.title.zeroize();
        zeroize_option(&mut self.first_name);
        zeroize_option(&mut self.middle_name);
        zeroize_option(&mut self.last_name);
        zeroize_option(&mut self.birth_date);
        self.emails.zeroize();
        self.phones.zeroize();
        self.addresses.zeroize();
        zeroize_option(&mut self.organization);
        zeroize_option(&mut self.department);
        zeroize_option(&mut self.job_title);
        zeroize_option(&mut self.website);
        zeroize_option(&mut self.notes);
        zeroize_option(&mut self.folder);
    }
}
impl Drop for IdentityItem {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct NewIdentityItem {
    pub title: String,
    pub first_name: Option<String>,
    pub middle_name: Option<String>,
    pub last_name: Option<String>,
    pub birth_date: Option<String>,
    pub emails: Vec<IdentityValue>,
    pub phones: Vec<IdentityValue>,
    pub addresses: Vec<PostalAddress>,
    pub organization: Option<String>,
    pub department: Option<String>,
    pub job_title: Option<String>,
    pub website: Option<String>,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub favorite: bool,
}

impl NewIdentityItem {
    pub fn into_identity(mut self) -> Result<IdentityItem, VaultError> {
        normalize_identity(&mut self);
        validate_identity(&self)?;
        assign_identity_child_ids(&mut self.emails, &mut self.phones, &mut self.addresses);
        Ok(IdentityItem {
            id: Uuid::new_v4(),
            title: std::mem::take(&mut self.title),
            first_name: self.first_name.take(),
            middle_name: self.middle_name.take(),
            last_name: self.last_name.take(),
            birth_date: self.birth_date.take(),
            emails: std::mem::take(&mut self.emails),
            phones: std::mem::take(&mut self.phones),
            addresses: std::mem::take(&mut self.addresses),
            organization: self.organization.take(),
            department: self.department.take(),
            job_title: self.job_title.take(),
            website: self.website.take(),
            notes: self.notes.take(),
            folder: self.folder.take(),
            favorite: self.favorite,
        })
    }
}

impl Zeroize for NewIdentityItem {
    fn zeroize(&mut self) {
        self.title.zeroize();
        zeroize_option(&mut self.first_name);
        zeroize_option(&mut self.middle_name);
        zeroize_option(&mut self.last_name);
        zeroize_option(&mut self.birth_date);
        self.emails.zeroize();
        self.phones.zeroize();
        self.addresses.zeroize();
        zeroize_option(&mut self.organization);
        zeroize_option(&mut self.department);
        zeroize_option(&mut self.job_title);
        zeroize_option(&mut self.website);
        zeroize_option(&mut self.notes);
        zeroize_option(&mut self.folder);
    }
}

impl Drop for NewIdentityItem {
    fn drop(&mut self) {
        self.zeroize();
    }
}

/// A complete replacement update. Identity edits are intentionally atomic so
/// a revision always represents a coherent structured profile.
#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct IdentityItemUpdate {
    pub id: Uuid,
    pub value: NewIdentityItem,
}

impl Zeroize for IdentityItemUpdate {
    fn zeroize(&mut self) {
        self.value.zeroize();
    }
}

impl Drop for IdentityItemUpdate {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct IdentitySummary {
    pub id: Uuid,
    pub title: String,
    pub display_name: Option<String>,
    pub organization: Option<String>,
    pub folder: Option<String>,
    pub favorite: bool,
}
impl From<&IdentityItem> for IdentitySummary {
    fn from(item: &IdentityItem) -> Self {
        Self {
            id: item.id,
            title: item.title.clone(),
            display_name: display_name(item),
            organization: item.organization.clone(),
            folder: item.folder.clone(),
            favorite: item.favorite,
        }
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct IdentityDetail {
    pub id: Uuid,
    pub title: String,
    pub first_name: Option<String>,
    pub middle_name: Option<String>,
    pub last_name: Option<String>,
    pub birth_date: Option<String>,
    pub emails: Vec<IdentityValue>,
    pub phones: Vec<IdentityValue>,
    pub addresses: Vec<PostalAddress>,
    pub organization: Option<String>,
    pub department: Option<String>,
    pub job_title: Option<String>,
    pub website: Option<String>,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub favorite: bool,
}
impl From<&IdentityItem> for IdentityDetail {
    fn from(item: &IdentityItem) -> Self {
        Self {
            id: item.id,
            title: item.title.clone(),
            first_name: item.first_name.clone(),
            middle_name: item.middle_name.clone(),
            last_name: item.last_name.clone(),
            birth_date: item.birth_date.clone(),
            emails: item.emails.clone(),
            phones: item.phones.clone(),
            addresses: item.addresses.clone(),
            organization: item.organization.clone(),
            department: item.department.clone(),
            job_title: item.job_title.clone(),
            website: item.website.clone(),
            notes: item.notes.clone(),
            folder: item.folder.clone(),
            favorite: item.favorite,
        }
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct TrashedIdentity {
    pub trash_id: Uuid,
    pub deleted_at: u64,
    pub item: IdentityItem,
}
impl fmt::Debug for TrashedIdentity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TrashedIdentity")
            .field("trash_id", &self.trash_id)
            .field("item", &self.item)
            .finish()
    }
}
impl Zeroize for TrashedIdentity {
    fn zeroize(&mut self) {
        self.item.zeroize();
    }
}
impl Drop for TrashedIdentity {
    fn drop(&mut self) {
        self.zeroize();
    }
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct IdentityTrashSummary {
    pub trash_id: Uuid,
    pub item_id: Uuid,
    pub title: String,
    pub display_name: Option<String>,
    pub deleted_at: u64,
}
impl From<&TrashedIdentity> for IdentityTrashSummary {
    fn from(entry: &TrashedIdentity) -> Self {
        Self {
            trash_id: entry.trash_id,
            item_id: entry.item.id,
            title: entry.item.title.clone(),
            display_name: display_name(&entry.item),
            deleted_at: entry.deleted_at,
        }
    }
}
#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct IdentityRevision {
    pub revision_id: Uuid,
    pub item_id: Uuid,
    pub saved_at: u64,
    pub item: IdentityItem,
}
impl fmt::Debug for IdentityRevision {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("IdentityRevision")
            .field("revision_id", &self.revision_id)
            .field("item_id", &self.item_id)
            .finish()
    }
}
impl Zeroize for IdentityRevision {
    fn zeroize(&mut self) {
        self.item.zeroize();
    }
}
impl Drop for IdentityRevision {
    fn drop(&mut self) {
        self.zeroize();
    }
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct IdentityRevisionSummary {
    pub revision_id: Uuid,
    pub item_id: Uuid,
    pub title: String,
    pub display_name: Option<String>,
    pub saved_at: u64,
}
impl From<&IdentityRevision> for IdentityRevisionSummary {
    fn from(revision: &IdentityRevision) -> Self {
        Self {
            revision_id: revision.revision_id,
            item_id: revision.item_id,
            title: revision.item.title.clone(),
            display_name: display_name(&revision.item),
            saved_at: revision.saved_at,
        }
    }
}

pub(super) fn display_name(item: &IdentityItem) -> Option<String> {
    let value = [
        item.first_name.as_deref(),
        item.middle_name.as_deref(),
        item.last_name.as_deref(),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ");
    (!value.is_empty()).then_some(value)
}
pub(super) fn assign_identity_child_ids(
    emails: &mut [IdentityValue],
    phones: &mut [IdentityValue],
    addresses: &mut [PostalAddress],
) {
    for value in emails {
        if value.id.is_nil() {
            value.id = Uuid::new_v4();
        }
    }
    for value in phones {
        if value.id.is_nil() {
            value.id = Uuid::new_v4();
        }
    }
    for value in addresses {
        if value.id.is_nil() {
            value.id = Uuid::new_v4();
        }
    }
}
pub(crate) fn validate_identity(input: &NewIdentityItem) -> Result<(), VaultError> {
    if input.title.is_empty()
        || input
            .emails
            .iter()
            .any(|entry| !is_valid_email(&entry.value))
        || input
            .phones
            .iter()
            .any(|entry| entry.value.trim().is_empty())
        || input.addresses.iter().any(|entry| {
            entry.address_line1.trim().is_empty()
                || entry
                    .country_code
                    .as_ref()
                    .is_some_and(|code| !is_iso_country_code(code))
        })
    {
        return Err(VaultError::InvalidIdentity);
    }
    if input.emails.iter().filter(|entry| entry.preferred).count() > 1
        || input.phones.iter().filter(|entry| entry.preferred).count() > 1
        || input
            .addresses
            .iter()
            .filter(|entry| entry.preferred)
            .count()
            > 1
    {
        return Err(VaultError::InvalidIdentity);
    }
    if input
        .birth_date
        .as_deref()
        .is_some_and(|date| !is_iso_date(date))
        || input
            .website
            .as_deref()
            .is_some_and(|url| !is_http_url(url))
    {
        return Err(VaultError::InvalidIdentity);
    }
    Ok(())
}

pub(super) fn normalize_identity(input: &mut NewIdentityItem) {
    trim_string(&mut input.title);
    for value in [
        &mut input.first_name,
        &mut input.middle_name,
        &mut input.last_name,
        &mut input.birth_date,
        &mut input.organization,
        &mut input.department,
        &mut input.job_title,
        &mut input.website,
        &mut input.notes,
        &mut input.folder,
    ] {
        trim_option(value);
    }
    for value in input.emails.iter_mut().chain(input.phones.iter_mut()) {
        trim_string(&mut value.label);
        trim_string(&mut value.value);
    }
    for address in &mut input.addresses {
        trim_string(&mut address.label);
        trim_string(&mut address.address_line1);
        for value in [
            &mut address.address_line2,
            &mut address.city,
            &mut address.region,
            &mut address.postal_code,
            &mut address.country_code,
            &mut address.country,
        ] {
            trim_option(value);
        }
        if let Some(code) = &mut address.country_code {
            code.make_ascii_uppercase();
        }
    }
}

pub(super) fn trim_string(value: &mut String) {
    let trimmed = value.trim();
    if trimmed.len() != value.len() {
        *value = trimmed.to_owned();
    }
}

pub(super) fn trim_option(value: &mut Option<String>) {
    if let Some(text) = value {
        trim_string(text);
        if text.is_empty() {
            text.zeroize();
            *value = None;
        }
    }
}

pub(super) fn is_valid_email(value: &str) -> bool {
    let mut parts = value.split('@');
    let (Some(local), Some(domain), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    !local.is_empty()
        && !domain.is_empty()
        && domain.contains('.')
        && !value.chars().any(char::is_whitespace)
}

pub(super) fn is_iso_country_code(value: &str) -> bool {
    value.len() == 2 && value.bytes().all(|byte| byte.is_ascii_alphabetic())
}

pub(super) fn is_http_url(value: &str) -> bool {
    let Some((scheme, remainder)) = value.split_once("://") else {
        return false;
    };
    matches!(scheme, "https" | "http")
        && !remainder.is_empty()
        && !remainder.starts_with('/')
        && !remainder.chars().any(char::is_whitespace)
}
pub(super) fn is_iso_date(value: &str) -> bool {
    let mut parts = value.split('-');
    let (Some(year), Some(month), Some(day), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    let (Ok(year), Ok(month), Ok(day)) = (
        year.parse::<i32>(),
        month.parse::<u32>(),
        day.parse::<u32>(),
    ) else {
        return false;
    };
    year >= 1
        && (1..=12).contains(&month)
        && day >= 1
        && day
            <= match month {
                2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
                2 => 28,
                4 | 6 | 9 | 11 => 30,
                _ => 31,
            }
}
