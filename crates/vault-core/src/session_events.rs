use super::*;

impl VaultSession {
    /// Appends a coarse successful-unlock audit record. Callers invoke this
    /// only after authentication succeeds; it never receives credentials.
    pub fn record_unlock_event(
        &mut self,
        source: UnlockEventSource,
    ) -> Result<UnlockEvent, VaultError> {
        let event = UnlockEvent {
            event_id: Uuid::new_v4(),
            occurred_at: unix_time_now(),
            source,
        };
        let events = &mut self.payload_mut()?.unlock_events;
        events.insert(0, event.clone());
        events.truncate(MAX_UNLOCK_EVENTS);
        Ok(event)
    }

    pub fn unlock_events(&self) -> Result<Vec<UnlockEvent>, VaultError> {
        Ok(self.payload()?.unlock_events.clone())
    }

    /// Records a fill only after the browser reports that assignments were
    /// applied. Field values and field names are intentionally not accepted.
    pub fn record_fill_event(
        &mut self,
        item_kind: FillItemKind,
        item_id: Uuid,
        item_title: String,
        origin: String,
        field_count: u32,
    ) -> Result<FillEvent, VaultError> {
        let event = FillEvent {
            event_id: Uuid::new_v4(),
            occurred_at: unix_time_now(),
            item_kind,
            item_id,
            item_title,
            origin,
            field_count,
        };
        let events = &mut self.payload_mut()?.fill_events;
        events.insert(0, event.clone());
        events.truncate(MAX_FILL_EVENTS);
        Ok(event)
    }

    pub fn fill_events(&self) -> Result<Vec<FillEvent>, VaultError> {
        Ok(self.payload()?.fill_events.clone())
    }

    pub fn email_accounts(&self) -> Result<Vec<EmailAccountRecordSummary>, VaultError> {
        Ok(self
            .payload()?
            .email_accounts
            .iter()
            .map(EmailAccountRecordSummary::from)
            .collect())
    }

    pub fn email_account(&self, id: Uuid) -> Result<EmailAccountRecord, VaultError> {
        self.payload()?
            .email_accounts
            .iter()
            .find(|account| account.id == id)
            .cloned()
            .ok_or(VaultError::ItemNotFound)
    }

    pub fn add_email_account(
        &mut self,
        mut input: NewEmailAccountRecord,
    ) -> Result<EmailAccountRecordSummary, VaultError> {
        crate::model::validate_email_account(
            &input.label,
            &input.address,
            &input.provider,
            &input.auth_kind,
            &input.credential,
            &input.imap_host,
            input.imap_port,
        )?;
        let account = EmailAccountRecord {
            id: Uuid::new_v4(),
            label: std::mem::take(&mut input.label),
            address: std::mem::take(&mut input.address),
            provider: std::mem::take(&mut input.provider),
            auth_kind: std::mem::take(&mut input.auth_kind),
            credential: std::mem::take(&mut input.credential),
            imap_host: std::mem::take(&mut input.imap_host),
            imap_port: input.imap_port,
            use_tls: input.use_tls,
            enabled: input.enabled,
        };
        let summary = EmailAccountRecordSummary::from(&account);
        self.payload_mut()?.email_accounts.push(account);
        Ok(summary)
    }

    pub fn update_email_account(
        &mut self,
        mut update: EmailAccountRecordUpdate,
    ) -> Result<EmailAccountRecordSummary, VaultError> {
        let index = self
            .payload()?
            .email_accounts
            .iter()
            .position(|account| account.id == update.id)
            .ok_or(VaultError::ItemNotFound)?;
        let credential = update
            .credential
            .as_deref()
            .unwrap_or(&self.payload()?.email_accounts[index].credential);
        crate::model::validate_email_account(
            &update.label,
            &update.address,
            &update.provider,
            &update.auth_kind,
            credential,
            &update.imap_host,
            update.imap_port,
        )?;
        let account = &mut self.payload_mut()?.email_accounts[index];
        account.label.zeroize();
        account.label = std::mem::take(&mut update.label);
        account.address.zeroize();
        account.address = std::mem::take(&mut update.address);
        account.provider.zeroize();
        account.provider = std::mem::take(&mut update.provider);
        account.auth_kind.zeroize();
        account.auth_kind = std::mem::take(&mut update.auth_kind);
        if let Some(mut credential) = update.credential.take() {
            account.credential.zeroize();
            account.credential = std::mem::take(&mut credential);
        }
        account.imap_host.zeroize();
        account.imap_host = std::mem::take(&mut update.imap_host);
        account.imap_port = update.imap_port;
        account.use_tls = update.use_tls;
        account.enabled = update.enabled;
        Ok(EmailAccountRecordSummary::from(&*account))
    }

    pub fn delete_email_account(&mut self, id: Uuid) -> Result<(), VaultError> {
        let index = self
            .payload()?
            .email_accounts
            .iter()
            .position(|account| account.id == id)
            .ok_or(VaultError::ItemNotFound)?;
        self.payload_mut()?.email_accounts.remove(index);
        Ok(())
    }
}
