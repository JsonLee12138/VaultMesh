use super::*;

/// A decrypted payment card. Protected numeric fields only live inside an
/// unlocked core session and are never included in renderer-facing DTOs.
#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct PaymentCardItem {
    pub id: Uuid,
    pub title: String,
    pub cardholder_name: String,
    pub card_number: String,
    pub expiration_month: u8,
    pub expiration_year: u16,
    pub security_code: Option<String>,
    pub pin: Option<String>,
    pub issuer: Option<String>,
    pub network: Option<String>,
    pub billing_address: Option<String>,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub favorite: bool,
    pub master_password_reprompt: bool,
}

impl fmt::Debug for PaymentCardItem {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PaymentCardItem")
            .field("id", &self.id)
            .field("title", &self.title)
            .field("cardholder_name", &self.cardholder_name)
            .field("card_number", &"[REDACTED]")
            .field("expiration_month", &self.expiration_month)
            .field("expiration_year", &self.expiration_year)
            .field(
                "security_code",
                &self.security_code.as_ref().map(|_| "[REDACTED]"),
            )
            .field("pin", &self.pin.as_ref().map(|_| "[REDACTED]"))
            .field("issuer", &self.issuer)
            .field("network", &self.network)
            .field(
                "billing_address",
                &self.billing_address.as_ref().map(|_| "[REDACTED]"),
            )
            .field("notes", &self.notes.as_ref().map(|_| "[REDACTED]"))
            .field("folder", &self.folder)
            .field("favorite", &self.favorite)
            .field("master_password_reprompt", &self.master_password_reprompt)
            .finish()
    }
}

impl Zeroize for PaymentCardItem {
    fn zeroize(&mut self) {
        self.title.zeroize();
        self.cardholder_name.zeroize();
        self.card_number.zeroize();
        zeroize_option(&mut self.security_code);
        zeroize_option(&mut self.pin);
        zeroize_option(&mut self.issuer);
        zeroize_option(&mut self.network);
        zeroize_option(&mut self.billing_address);
        zeroize_option(&mut self.notes);
        zeroize_option(&mut self.folder);
    }
}

impl Drop for PaymentCardItem {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct NewPaymentCardItem {
    pub title: String,
    pub cardholder_name: String,
    pub card_number: String,
    pub expiration_month: u8,
    pub expiration_year: u16,
    pub security_code: Option<String>,
    pub pin: Option<String>,
    pub issuer: Option<String>,
    pub network: Option<String>,
    pub billing_address: Option<String>,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub favorite: bool,
    pub master_password_reprompt: bool,
}

impl NewPaymentCardItem {
    pub fn into_payment_card(mut self) -> Result<PaymentCardItem, VaultError> {
        let card_number = normalize_card_number(&self.card_number)?;
        validate_card_fields(
            self.expiration_month,
            self.expiration_year,
            self.security_code.as_deref(),
            self.pin.as_deref(),
        )?;
        Ok(PaymentCardItem {
            id: Uuid::new_v4(),
            title: std::mem::take(&mut self.title),
            cardholder_name: std::mem::take(&mut self.cardholder_name),
            card_number,
            expiration_month: self.expiration_month,
            expiration_year: self.expiration_year,
            security_code: self.security_code.take(),
            pin: self.pin.take(),
            issuer: self.issuer.take(),
            network: self.network.take(),
            billing_address: self.billing_address.take(),
            notes: self.notes.take(),
            folder: self.folder.take(),
            favorite: self.favorite,
            master_password_reprompt: self.master_password_reprompt,
        })
    }
}

impl Zeroize for NewPaymentCardItem {
    fn zeroize(&mut self) {
        self.title.zeroize();
        self.cardholder_name.zeroize();
        self.card_number.zeroize();
        zeroize_option(&mut self.security_code);
        zeroize_option(&mut self.pin);
        zeroize_option(&mut self.issuer);
        zeroize_option(&mut self.network);
        zeroize_option(&mut self.billing_address);
        zeroize_option(&mut self.notes);
        zeroize_option(&mut self.folder);
    }
}

impl Drop for NewPaymentCardItem {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct PaymentCardItemUpdate {
    pub id: Uuid,
    pub title: String,
    pub cardholder_name: String,
    /// `None` preserves the existing primary account number.
    pub card_number: Option<String>,
    pub expiration_month: u8,
    pub expiration_year: u16,
    pub security_code: Option<String>,
    pub clear_security_code: bool,
    pub pin: Option<String>,
    pub clear_pin: bool,
    pub issuer: Option<String>,
    pub network: Option<String>,
    pub billing_address: Option<String>,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub favorite: bool,
    pub master_password_reprompt: bool,
}

impl Zeroize for PaymentCardItemUpdate {
    fn zeroize(&mut self) {
        self.title.zeroize();
        self.cardholder_name.zeroize();
        zeroize_option(&mut self.card_number);
        zeroize_option(&mut self.security_code);
        zeroize_option(&mut self.pin);
        zeroize_option(&mut self.issuer);
        zeroize_option(&mut self.network);
        zeroize_option(&mut self.billing_address);
        zeroize_option(&mut self.notes);
        zeroize_option(&mut self.folder);
    }
}

impl Drop for PaymentCardItemUpdate {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PaymentCardSummary {
    pub id: Uuid,
    pub title: String,
    pub cardholder_name: String,
    pub masked_number: String,
    pub expiration_month: u8,
    pub expiration_year: u16,
    pub has_security_code: bool,
    pub has_pin: bool,
    pub issuer: Option<String>,
    pub network: Option<String>,
    pub notes: Option<String>,
    pub master_password_reprompt: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PaymentCardDetail {
    pub id: Uuid,
    pub title: String,
    pub cardholder_name: String,
    pub masked_number: String,
    pub expiration_month: u8,
    pub expiration_year: u16,
    pub has_security_code: bool,
    pub has_pin: bool,
    pub issuer: Option<String>,
    pub network: Option<String>,
    pub billing_address: Option<String>,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub favorite: bool,
    pub master_password_reprompt: bool,
}

impl From<&PaymentCardItem> for PaymentCardSummary {
    fn from(item: &PaymentCardItem) -> Self {
        Self {
            id: item.id,
            title: item.title.clone(),
            cardholder_name: item.cardholder_name.clone(),
            masked_number: mask_card_number(&item.card_number),
            expiration_month: item.expiration_month,
            expiration_year: item.expiration_year,
            has_security_code: item.security_code.is_some(),
            has_pin: item.pin.is_some(),
            issuer: item.issuer.clone(),
            network: item.network.clone(),
            notes: item.notes.clone(),
            master_password_reprompt: item.master_password_reprompt,
        }
    }
}

impl From<&PaymentCardItem> for PaymentCardDetail {
    fn from(item: &PaymentCardItem) -> Self {
        Self {
            id: item.id,
            title: item.title.clone(),
            cardholder_name: item.cardholder_name.clone(),
            masked_number: mask_card_number(&item.card_number),
            expiration_month: item.expiration_month,
            expiration_year: item.expiration_year,
            has_security_code: item.security_code.is_some(),
            has_pin: item.pin.is_some(),
            issuer: item.issuer.clone(),
            network: item.network.clone(),
            billing_address: item.billing_address.clone(),
            notes: item.notes.clone(),
            folder: item.folder.clone(),
            favorite: item.favorite,
            master_password_reprompt: item.master_password_reprompt,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TrashedPaymentCard {
    pub trash_id: Uuid,
    pub deleted_at: u64,
    pub item: PaymentCardItem,
}

impl Zeroize for TrashedPaymentCard {
    fn zeroize(&mut self) {
        self.item.zeroize();
    }
}

impl Drop for TrashedPaymentCard {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PaymentCardRevision {
    pub revision_id: Uuid,
    pub item_id: Uuid,
    pub saved_at: u64,
    pub item: PaymentCardItem,
}

impl Zeroize for PaymentCardRevision {
    fn zeroize(&mut self) {
        self.item.zeroize();
    }
}

impl Drop for PaymentCardRevision {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PaymentCardTrashSummary {
    pub trash_id: Uuid,
    pub item_id: Uuid,
    pub title: String,
    pub masked_number: String,
    pub deleted_at: u64,
}

impl From<&TrashedPaymentCard> for PaymentCardTrashSummary {
    fn from(entry: &TrashedPaymentCard) -> Self {
        Self {
            trash_id: entry.trash_id,
            item_id: entry.item.id,
            title: entry.item.title.clone(),
            masked_number: mask_card_number(&entry.item.card_number),
            deleted_at: entry.deleted_at,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PaymentCardRevisionSummary {
    pub revision_id: Uuid,
    pub item_id: Uuid,
    pub title: String,
    pub masked_number: String,
    pub saved_at: u64,
}

impl From<&PaymentCardRevision> for PaymentCardRevisionSummary {
    fn from(revision: &PaymentCardRevision) -> Self {
        Self {
            revision_id: revision.revision_id,
            item_id: revision.item_id,
            title: revision.item.title.clone(),
            masked_number: mask_card_number(&revision.item.card_number),
            saved_at: revision.saved_at,
        }
    }
}
