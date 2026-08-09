use std::fmt;

use base64::{Engine as _, engine::general_purpose::STANDARD_NO_PAD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::Zeroize;

use crate::{VaultError, normalize_totp_secret};

#[path = "model_api_environment.rs"]
mod model_api_environment;
#[path = "model_api_request.rs"]
mod model_api_request;
#[path = "model_card.rs"]
mod model_card;
#[path = "model_identity.rs"]
mod model_identity;
#[path = "model_login.rs"]
mod model_login;
#[path = "model_login_view.rs"]
mod model_login_view;
#[path = "model_payload.rs"]
mod model_payload;
#[path = "model_secret.rs"]
mod model_secret;
#[path = "model_service.rs"]
mod model_service;
#[path = "model_ssh.rs"]
mod model_ssh;
#[path = "model_validators.rs"]
mod model_validators;

pub use model_api_environment::*;
pub use model_api_request::*;
pub use model_card::*;
pub use model_identity::*;
use model_identity::{is_http_url, is_iso_date};
pub use model_login::*;
pub use model_login_view::*;
pub use model_payload::*;
pub use model_secret::*;
pub use model_service::*;
pub use model_ssh::*;
use model_validators::{mask_card_number, public_key_metadata};
pub(crate) use model_validators::{
    normalize_card_number, validate_card_fields, validate_ssh_fields,
};

pub(crate) fn validate_recovery_codes(codes: &[String]) -> Result<(), VaultError> {
    if codes.len() > 100
        || codes
            .iter()
            .any(|code| code.trim().is_empty() || code.encode_utf16().count() > 256)
    {
        return Err(VaultError::InvalidRecoveryCodes);
    }
    Ok(())
}

fn zeroize_option(value: &mut Option<String>) {
    if let Some(value) = value {
        value.zeroize();
    }
}
