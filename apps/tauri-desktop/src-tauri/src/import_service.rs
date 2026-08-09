use std::{collections::HashMap, time::Duration};

use csv::{ReaderBuilder, StringRecord, Trim};
use serde_json::{Value, json};
use uuid::Uuid;
use zeroize::Zeroizing;

pub const MAX_IMPORT_FILE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_IMPORT_ROWS: usize = 5_000;
const PREVIEW_LIMIT: usize = 20;
const SESSION_LIFETIME: Duration = Duration::from_secs(10 * 60);

const SOURCES: &[&str] = &[
    "chromium",
    "edge",
    "firefox",
    "safari",
    "onePassword",
    "bitwarden",
    "lastPass",
    "dashlane",
    "keepass",
    "csv",
];

const TITLE: &[&str] = &["title", "name", "名称", "标题", "item name"];
const USERNAME: &[&str] = &[
    "username",
    "user name",
    "login",
    "login username",
    "login_username",
    "email",
    "登录名",
    "用户名",
];
const PASSWORD: &[&str] = &[
    "password",
    "pass",
    "login password",
    "login_password",
    "密码",
];
const URL: &[&str] = &[
    "url",
    "website",
    "web site",
    "login uri",
    "login_uri",
    "网址",
    "网站",
];
const NOTES: &[&str] = &["notes", "note", "extra", "备注"];
const KIND: &[&str] = &["type", "item type"];
const FOLDER: &[&str] = &["folder", "group", "grouping", "folder name", "folder_name"];
const FAVORITE: &[&str] = &["favorite", "fav"];
const TOTP: &[&str] = &[
    "totp",
    "totp secret",
    "login totp",
    "login_totp",
    "one-time password",
    "otp",
];
const CARDHOLDER: &[&str] = &[
    "cardholder name",
    "cardholder_name",
    "cardholder",
    "name on card",
];
const CARD_NUMBER: &[&str] = &[
    "number",
    "card number",
    "card_number",
    "ccnum",
    "credit card number",
];
const EXP_MONTH: &[&str] = &[
    "exp month",
    "exp_month",
    "expiration month",
    "expiration_month",
    "month",
];
const EXP_YEAR: &[&str] = &[
    "exp year",
    "exp_year",
    "expiration year",
    "expiration_year",
    "year",
];
const SECURITY_CODE: &[&str] = &["code", "security code", "security_code", "cvv", "cvc"];
const NETWORK: &[&str] = &["brand", "network", "card type"];
const ISSUER: &[&str] = &["issuer", "bank", "organization"];
const BILLING_ADDRESS: &[&str] = &["billing address", "billing_address", "address"];
const HOST: &[&str] = &["host", "hostname", "server"];
const PORT: &[&str] = &["port"];
const PUBLIC_KEY: &[&str] = &["public key", "public_key"];
const PRIVATE_KEY: &[&str] = &["private key", "private_key"];
const KEY_PASSPHRASE: &[&str] = &["key passphrase", "key_passphrase", "passphrase"];

struct PendingImport {
    source: String,
    file_name: String,
    contents: Zeroizing<String>,
    expires_at: u64,
}

#[derive(Default)]
pub struct ImportService {
    pending: HashMap<Uuid, PendingImport>,
}

struct ParsedImport {
    logins: Vec<Value>,
    payment_cards: Vec<Value>,
    ssh_credentials: Vec<Value>,
    skipped_count: usize,
}

impl ParsedImport {
    fn importable_count(&self) -> usize {
        self.logins.len() + self.payment_cards.len() + self.ssh_credentials.len()
    }

    fn payload(self) -> Value {
        json!({
            "logins": self.logins,
            "paymentCards": self.payment_cards,
            "sshCredentials": self.ssh_credentials,
        })
    }
}

impl ImportService {
    pub fn prepare(
        &mut self,
        source: &str,
        file_name: String,
        contents: Zeroizing<String>,
        now_ms: u64,
    ) -> Result<Value, String> {
        self.prune(now_ms);
        validate_source(source)?;
        validate_file_name(source, &file_name)?;
        let parsed = parse_import(source, &file_name, contents.as_str())?;
        if parsed.importable_count() == 0 {
            return Err(
                "没有找到可导入的登录信息、支付卡或 SSH 凭据。请确认选择了正确的软件和导出文件。"
                    .into(),
            );
        }

        let session_id = Uuid::new_v4();
        let preview = preview(&parsed, session_id, source, &file_name);
        self.pending.insert(
            session_id,
            PendingImport {
                source: source.to_owned(),
                file_name,
                contents,
                expires_at: now_ms.saturating_add(SESSION_LIFETIME.as_millis() as u64),
            },
        );
        Ok(preview)
    }

    pub fn take_payload(&mut self, session_id: &str, now_ms: u64) -> Result<Value, String> {
        self.prune(now_ms);
        let id = Uuid::parse_str(session_id).map_err(|_| "请求参数无效。")?;
        let pending = self
            .pending
            .remove(&id)
            .ok_or("导入预览已失效，请重新选择导出文件。")?;
        parse_import(
            &pending.source,
            &pending.file_name,
            pending.contents.as_str(),
        )
        .map(ParsedImport::payload)
    }

    pub fn cancel(&mut self, session_id: &str, now_ms: u64) -> Result<(), String> {
        self.prune(now_ms);
        let id = Uuid::parse_str(session_id).map_err(|_| "请求参数无效。")?;
        self.pending.remove(&id);
        Ok(())
    }

    pub fn clear(&mut self) {
        self.pending.clear();
    }

    pub fn prune_expired(&mut self, now_ms: u64) {
        self.prune(now_ms);
    }

    fn prune(&mut self, now_ms: u64) {
        self.pending
            .retain(|_, pending| pending.expires_at > now_ms);
    }
}

pub fn validate_source(source: &str) -> Result<(), String> {
    SOURCES
        .contains(&source)
        .then_some(())
        .ok_or_else(|| "导入来源无效。".to_owned())
}

fn validate_file_name(source: &str, file_name: &str) -> Result<(), String> {
    let lower = file_name.to_ascii_lowercase();
    let supported = lower.ends_with(".csv") || (source == "bitwarden" && lower.ends_with(".json"));
    supported
        .then_some(())
        .ok_or_else(|| "请选择所选来源支持的 CSV 或 JSON 导出文件。".to_owned())
}

fn parse_import(source: &str, file_name: &str, contents: &str) -> Result<ParsedImport, String> {
    if source == "bitwarden" && file_name.to_ascii_lowercase().ends_with(".json") {
        parse_bitwarden_json(contents)
    } else {
        parse_csv(contents)
    }
}

fn parse_csv(contents: &str) -> Result<ParsedImport, String> {
    let mut reader = ReaderBuilder::new()
        .flexible(true)
        .trim(Trim::All)
        .from_reader(contents.as_bytes());
    let headers = reader
        .headers()
        .map_err(|_| "CSV 文件格式无效。请检查引号和换行。")?
        .iter()
        .map(normalize_header)
        .collect::<Vec<_>>();
    let has_password = find_column(&headers, PASSWORD).is_some();
    let has_card = find_column(&headers, CARD_NUMBER).is_some();
    let has_ssh =
        find_column(&headers, PUBLIC_KEY).is_some() || find_column(&headers, PRIVATE_KEY).is_some();
    if !has_password && !has_card && !has_ssh {
        return Err("无法识别密码、卡号或 SSH 密钥列。请使用所选软件导出的 CSV 文件。".into());
    }

    let mut parsed = ParsedImport {
        logins: Vec::new(),
        payment_cards: Vec::new(),
        ssh_credentials: Vec::new(),
        skipped_count: 0,
    };
    for (index, result) in reader.records().enumerate() {
        if index >= MAX_IMPORT_ROWS {
            parsed.skipped_count += 1;
            continue;
        }
        let record = result.map_err(|_| "CSV 文件格式无效。请检查引号和换行。")?;
        if record.iter().all(|value| value.trim().is_empty()) {
            continue;
        }
        let row = CsvRow {
            headers: &headers,
            record: &record,
        };
        let kind = row.read(KIND).to_ascii_lowercase();
        if is_ssh_type(&kind) {
            let items = csv_ssh(&row, index + 1);
            if items.is_empty() {
                parsed.skipped_count += 1;
            } else {
                parsed.ssh_credentials.extend(items);
            }
            continue;
        }
        let is_card = is_card_type(&kind)
            || (kind.is_empty()
                && row.read(PASSWORD).is_empty()
                && !row.read(CARD_NUMBER).is_empty());
        if is_card {
            if let Some(item) = csv_card(&row, index + 1) {
                parsed.payment_cards.push(item);
            } else {
                parsed.skipped_count += 1;
            }
        } else if let Some(item) = csv_login(&row, index + 1) {
            parsed.logins.push(item);
        } else {
            parsed.skipped_count += 1;
        }
    }
    Ok(parsed)
}

struct CsvRow<'a> {
    headers: &'a [String],
    record: &'a StringRecord,
}

impl CsvRow<'_> {
    fn read(&self, aliases: &[&str]) -> &str {
        find_column(self.headers, aliases)
            .and_then(|index| self.record.get(index))
            .unwrap_or("")
            .trim()
    }
}

fn csv_login(row: &CsvRow<'_>, row_index: usize) -> Option<Value> {
    let password = bounded_required(row.read(PASSWORD), 10_000)?;
    let url = bounded_optional(row.read(URL), 10_000)?;
    let username = bounded(row.read(USERNAME), 2_048)?;
    let title = bounded_title(
        row.read(TITLE),
        title_from(url.as_deref(), &username, row_index),
    )?;
    Some(json!({
        "title": title,
        "username": username,
        "password": password,
        "url": url,
        "notes": bounded_optional(row.read(NOTES), 10_000)?,
        "folder": bounded_optional(row.read(FOLDER), 256)?,
        "favorite": truthy(row.read(FAVORITE)),
        "totpSecret": bounded_optional(row.read(TOTP), 10_000)?,
        "additionalUrls": [],
        "autofillOnPageLoad": true,
        "masterPasswordReprompt": false,
        "customFields": [],
    }))
}

fn csv_card(row: &CsvRow<'_>, row_index: usize) -> Option<Value> {
    let card_number = row
        .read(CARD_NUMBER)
        .chars()
        .filter(|character| !character.is_whitespace() && *character != '-')
        .collect::<String>();
    if !(12..=32).contains(&card_number.len())
        || !card_number.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let month = row
        .read(EXP_MONTH)
        .parse::<u8>()
        .ok()
        .filter(|value| (1..=12).contains(value))?;
    let mut year = row.read(EXP_YEAR).parse::<u16>().ok()?;
    if year < 100 {
        year += 2_000;
    }
    if !(1_000..=9_999).contains(&year) {
        return None;
    }
    let cardholder = bounded_required(row.read(CARDHOLDER), 256)?;
    let title = bounded_title(row.read(TITLE), format!("导入的支付卡 {row_index}"))?;
    let security_code = bounded_optional(row.read(SECURITY_CODE), 4)?;
    if security_code.as_ref().is_some_and(|value| {
        !(3..=4).contains(&value.len()) || !value.bytes().all(|byte| byte.is_ascii_digit())
    }) {
        return None;
    }
    Some(json!({
        "title": title,
        "cardholderName": cardholder,
        "cardNumber": card_number,
        "expirationMonth": month,
        "expirationYear": year,
        "securityCode": security_code,
        "pin": null,
        "issuer": bounded_optional(row.read(ISSUER), 256)?,
        "network": bounded_optional(row.read(NETWORK), 256)?,
        "billingAddress": bounded_optional(row.read(BILLING_ADDRESS), 10_000)?,
        "notes": bounded_optional(row.read(NOTES), 10_000)?,
        "folder": bounded_optional(row.read(FOLDER), 256)?,
        "favorite": truthy(row.read(FAVORITE)),
        "masterPasswordReprompt": false,
    }))
}

fn csv_ssh(row: &CsvRow<'_>, row_index: usize) -> Vec<Value> {
    let host = bounded_optional(row.read(HOST), 256).flatten();
    let username = bounded(row.read(USERNAME), 2_048);
    let public_key = bounded_optional(row.read(PUBLIC_KEY), 1_048_576).flatten();
    let private_key = bounded_optional(row.read(PRIVATE_KEY), 1_048_576).flatten();
    let password = bounded_optional(row.read(PASSWORD), 10_000).flatten();
    let passphrase = bounded_optional(row.read(KEY_PASSPHRASE), 10_000).flatten();
    let port = row
        .read(PORT)
        .parse::<u16>()
        .ok()
        .filter(|value| *value > 0)
        .unwrap_or(22);
    let title = bounded_title(row.read(TITLE), format!("导入的 SSH 凭据 {row_index}"));
    let (Some(username), Some(title)) = (username, title) else {
        return Vec::new();
    };
    let common = json!({
        "port": port,
        "notes": bounded_optional(row.read(NOTES), 10_000).flatten(),
        "folder": bounded_optional(row.read(FOLDER), 256).flatten(),
        "favorite": truthy(row.read(FAVORITE)),
        "masterPasswordReprompt": false,
    });
    let mut items = Vec::new();
    if let Some(host) = host.clone().filter(|_| !username.is_empty()) {
        items.push(merge(
            common.clone(),
            json!({
                "title": title,
                "host": host,
                "username": username,
                "password": password,
                "publicKey": null,
                "privateKey": null,
                "keyPassphrase": null,
                "recordKind": "account",
            }),
        ));
    }
    if public_key.is_some() || private_key.is_some() {
        items.push(merge(
            common,
            json!({
                "title": if items.is_empty() { title } else { format!("{title} · SSH 密钥") },
                "host": null,
                "username": "",
                "password": null,
                "publicKey": public_key,
                "privateKey": private_key,
                "keyPassphrase": if private_key.is_some() { passphrase } else { None::<String> },
                "recordKind": "key",
            }),
        ));
    }
    items
}

fn parse_bitwarden_json(contents: &str) -> Result<ParsedImport, String> {
    let root: Value = serde_json::from_str(contents)
        .map_err(|_| "Bitwarden JSON 文件格式无效。请重新导出未加密的 JSON 文件。")?;
    let items = root
        .get("items")
        .and_then(Value::as_array)
        .ok_or("未找到 Bitwarden 记录。请确认选择了 Bitwarden JSON 导出文件。")?;
    let folders = root
        .get("folders")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|folder| {
            Some((
                folder.get("id")?.as_str()?.to_owned(),
                folder.get("name")?.as_str()?.to_owned(),
            ))
        })
        .collect::<HashMap<_, _>>();
    let mut parsed = ParsedImport {
        logins: Vec::new(),
        payment_cards: Vec::new(),
        ssh_credentials: Vec::new(),
        skipped_count: 0,
    };
    for (index, item) in items.iter().enumerate() {
        if index >= MAX_IMPORT_ROWS {
            parsed.skipped_count += 1;
            continue;
        }
        let folder = item
            .get("folderId")
            .and_then(Value::as_str)
            .and_then(|id| folders.get(id))
            .cloned();
        let candidate = match item.get("type").and_then(Value::as_u64) {
            Some(1) => bitwarden_login(item, folder),
            Some(3) => bitwarden_card(item, folder),
            Some(5) => bitwarden_ssh(item, folder),
            _ => None,
        };
        match (item.get("type").and_then(Value::as_u64), candidate) {
            (Some(1), Some(value)) => parsed.logins.push(value),
            (Some(3), Some(value)) => parsed.payment_cards.push(value),
            (Some(5), Some(value)) => parsed.ssh_credentials.push(value),
            _ => parsed.skipped_count += 1,
        }
    }
    Ok(parsed)
}

fn bitwarden_login(item: &Value, folder: Option<String>) -> Option<Value> {
    let login = item.get("login")?;
    let password = bounded_required(login.get("password")?.as_str()?, 10_000)?;
    let username = bounded(
        login.get("username").and_then(Value::as_str).unwrap_or(""),
        2_048,
    )?;
    let urls = login
        .get("uris")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| bounded_required(entry.get("uri")?.as_str()?, 10_000))
        .take(20)
        .collect::<Vec<_>>();
    let title = bounded_required(item.get("name")?.as_str()?, 256)?;
    let custom_fields = item
        .get("fields")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|field| {
            Some(json!({
                "label": bounded_required(field.get("name")?.as_str()?, 256)?,
                "value": bounded(field.get("value")?.as_str()?, 10_000)?,
            }))
        })
        .take(50)
        .collect::<Vec<_>>();
    Some(json!({
        "title": title,
        "username": username,
        "password": password,
        "url": urls.first(),
        "notes": bounded_optional(item.get("notes").and_then(Value::as_str).unwrap_or(""), 10_000)?,
        "folder": folder,
        "favorite": item.get("favorite").and_then(Value::as_bool).unwrap_or(false),
        "totpSecret": bounded_optional(login.get("totp").and_then(Value::as_str).unwrap_or(""), 10_000)?,
        "additionalUrls": urls.into_iter().skip(1).collect::<Vec<_>>(),
        "autofillOnPageLoad": true,
        "masterPasswordReprompt": item.get("reprompt").and_then(Value::as_u64) == Some(1),
        "customFields": custom_fields,
    }))
}

fn bitwarden_card(item: &Value, folder: Option<String>) -> Option<Value> {
    let card = item.get("card")?;
    let number = card.get("number")?.as_str()?.replace([' ', '-'], "");
    if !(12..=32).contains(&number.len()) || !number.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let month = card
        .get("expMonth")?
        .as_str()?
        .parse::<u8>()
        .ok()
        .filter(|value| (1..=12).contains(value))?;
    let year = card
        .get("expYear")?
        .as_str()?
        .parse::<u16>()
        .ok()
        .filter(|value| (1_000..=9_999).contains(value))?;
    Some(json!({
        "title": bounded_required(item.get("name")?.as_str()?, 256)?,
        "cardholderName": bounded_required(card.get("cardholderName")?.as_str()?, 256)?,
        "cardNumber": number,
        "expirationMonth": month,
        "expirationYear": year,
        "securityCode": bounded_optional(card.get("code").and_then(Value::as_str).unwrap_or(""), 4)?,
        "pin": null,
        "issuer": null,
        "network": bounded_optional(card.get("brand").and_then(Value::as_str).unwrap_or(""), 256)?,
        "billingAddress": null,
        "notes": bounded_optional(item.get("notes").and_then(Value::as_str).unwrap_or(""), 10_000)?,
        "folder": folder,
        "favorite": item.get("favorite").and_then(Value::as_bool).unwrap_or(false),
        "masterPasswordReprompt": item.get("reprompt").and_then(Value::as_u64) == Some(1),
    }))
}

fn bitwarden_ssh(item: &Value, folder: Option<String>) -> Option<Value> {
    let ssh = item.get("sshKey")?;
    let public_key = bounded_optional(
        ssh.get("publicKey").and_then(Value::as_str).unwrap_or(""),
        1_048_576,
    )?;
    let private_key = bounded_optional(
        ssh.get("privateKey").and_then(Value::as_str).unwrap_or(""),
        1_048_576,
    )?;
    if public_key.is_none() && private_key.is_none() {
        return None;
    }
    Some(json!({
        "title": bounded_required(item.get("name")?.as_str()?, 256)?,
        "host": null,
        "port": 22,
        "username": "",
        "password": null,
        "publicKey": public_key,
        "privateKey": private_key,
        "keyPassphrase": null,
        "notes": bounded_optional(item.get("notes").and_then(Value::as_str).unwrap_or(""), 10_000)?,
        "folder": folder,
        "favorite": item.get("favorite").and_then(Value::as_bool).unwrap_or(false),
        "masterPasswordReprompt": item.get("reprompt").and_then(Value::as_u64) == Some(1),
        "recordKind": "key",
    }))
}

fn preview(parsed: &ParsedImport, session_id: Uuid, source: &str, file_name: &str) -> Value {
    let items = parsed
        .logins
        .iter()
        .map(|item| preview_item("login", item, "username"))
        .chain(
            parsed
                .payment_cards
                .iter()
                .map(|item| preview_item("paymentCard", item, "cardholderName")),
        )
        .chain(
            parsed
                .ssh_credentials
                .iter()
                .map(|item| preview_item("sshCredential", item, "username")),
        )
        .take(PREVIEW_LIMIT)
        .collect::<Vec<_>>();
    json!({
        "sessionId": session_id,
        "source": source,
        "fileName": file_name,
        "importableCount": parsed.importable_count(),
        "loginCount": parsed.logins.len(),
        "paymentCardCount": parsed.payment_cards.len(),
        "sshCredentialCount": parsed.ssh_credentials.len(),
        "skippedCount": parsed.skipped_count,
        "items": items,
    })
}

fn preview_item(kind: &str, item: &Value, detail_key: &str) -> Value {
    json!({
        "type": kind,
        "title": item.get("title").and_then(Value::as_str).unwrap_or(""),
        "detail": item.get(detail_key).and_then(Value::as_str).unwrap_or(""),
    })
}

fn normalize_header(value: &str) -> String {
    value
        .trim_start_matches('\u{feff}')
        .trim()
        .to_ascii_lowercase()
}

fn find_column(headers: &[String], aliases: &[&str]) -> Option<usize> {
    headers
        .iter()
        .position(|header| aliases.contains(&header.as_str()))
}

fn bounded(value: &str, maximum: usize) -> Option<String> {
    (value.encode_utf16().count() <= maximum).then(|| value.to_owned())
}

fn bounded_required(value: &str, maximum: usize) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then_some(())?;
    bounded(value, maximum)
}

fn bounded_optional(value: &str, maximum: usize) -> Option<Option<String>> {
    let value = value.trim();
    if value.is_empty() {
        Some(None)
    } else {
        bounded(value, maximum).map(Some)
    }
}

fn bounded_title(value: &str, fallback: String) -> Option<String> {
    bounded_required(
        if value.trim().is_empty() {
            &fallback
        } else {
            value
        },
        256,
    )
}

fn truthy(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "y"
    )
}

fn title_from(url: Option<&str>, username: &str, row_index: usize) -> String {
    if let Some(url) = url {
        let without_scheme = url.split_once("://").map_or(url, |(_, rest)| rest);
        let host = without_scheme.split(['/', '?', '#']).next().unwrap_or(url);
        if !host.is_empty() {
            return host.to_owned();
        }
    }
    let username = username.trim();
    if username.is_empty() {
        format!("导入的登录信息 {row_index}")
    } else {
        username.to_owned()
    }
}

fn is_card_type(value: &str) -> bool {
    matches!(
        value.replace(['_', '-'], " ").as_str(),
        "card" | "credit card" | "creditcard" | "payment card" | "paymentcard"
    )
}

fn is_ssh_type(value: &str) -> bool {
    matches!(
        value.replace(['_', '-'], " ").as_str(),
        "ssh" | "ssh key" | "sshkey" | "ssh credential"
    )
}

fn merge(mut base: Value, overlay: Value) -> Value {
    let Some(base) = base.as_object_mut() else {
        return overlay;
    };
    if let Some(overlay) = overlay.as_object() {
        base.extend(overlay.clone());
    }
    Value::Object(std::mem::take(base))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_preview_and_single_use_payload_cover_the_tauri_import_regression() {
        let mut service = ImportService::default();
        let preview = service
            .prepare(
                "csv",
                "passwords.csv".into(),
                Zeroizing::new(
                    "title,username,password,url\nExample,ada,secret,https://example.test".into(),
                ),
                1_000,
            )
            .expect("preview");
        assert_eq!(preview["loginCount"], 1);
        assert_eq!(
            preview["items"][0],
            json!({ "type": "login", "title": "Example", "detail": "ada" })
        );
        assert!(
            !serde_json::to_string(&preview)
                .expect("json")
                .contains("secret")
        );

        let id = preview["sessionId"].as_str().expect("session id");
        let payload = service.take_payload(id, 1_001).expect("payload");
        assert_eq!(payload["logins"][0]["password"], "secret");
        assert!(service.take_payload(id, 1_002).is_err());
    }

    #[test]
    fn cancel_expiry_and_lock_cleanup_remove_pending_secrets() {
        let csv = || Zeroizing::new("title,username,password\nExample,ada,secret".into());
        let mut service = ImportService::default();
        let cancelled = service
            .prepare("csv", "a.csv".into(), csv(), 10)
            .expect("preview");
        let cancelled_id = cancelled["sessionId"].as_str().expect("id");
        service.cancel(cancelled_id, 11).expect("cancel");
        assert!(service.take_payload(cancelled_id, 12).is_err());

        let expired = service
            .prepare("csv", "b.csv".into(), csv(), 20)
            .expect("preview");
        let expired_id = expired["sessionId"].as_str().expect("id");
        assert!(
            service
                .take_payload(expired_id, 20 + SESSION_LIFETIME.as_millis() as u64)
                .is_err()
        );

        let locked = service
            .prepare("csv", "c.csv".into(), csv(), 30)
            .expect("preview");
        let locked_id = locked["sessionId"].as_str().expect("id");
        service.clear();
        assert!(service.take_payload(locked_id, 31).is_err());
    }

    #[test]
    fn parses_bitwarden_json_without_exposing_protected_fields_in_preview() {
        let contents = json!({
            "folders": [{ "id": "work", "name": "Work" }],
            "items": [
                { "type": 1, "name": "Example", "folderId": "work", "login": { "username": "ada", "password": "login-secret", "uris": [{ "uri": "https://example.test" }] } },
                { "type": 3, "name": "Card", "card": { "cardholderName": "Ada", "number": "4111 1111 1111 1111", "expMonth": "09", "expYear": "2030", "code": "123" } },
                { "type": 5, "name": "Key", "sshKey": { "publicKey": "ssh-ed25519 public", "privateKey": "private-secret" } }
            ]
        }).to_string();
        let mut service = ImportService::default();
        let preview = service
            .prepare(
                "bitwarden",
                "vault.json".into(),
                Zeroizing::new(contents),
                1,
            )
            .expect("preview");
        assert_eq!(preview["importableCount"], 3);
        let encoded = serde_json::to_string(&preview).expect("preview json");
        assert!(!encoded.contains("login-secret"));
        assert!(!encoded.contains("4111111111111111"));
        assert!(!encoded.contains("private-secret"));
    }

    #[test]
    fn rejects_unknown_sources_and_mismatched_file_types() {
        assert!(validate_source("unknown").is_err());
        assert!(validate_file_name("csv", "passwords.json").is_err());
        assert!(validate_file_name("bitwarden", "vault.json").is_ok());
        assert!(validate_file_name("safari", "Passwords.CSV").is_ok());
    }
}
