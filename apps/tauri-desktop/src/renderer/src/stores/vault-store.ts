import { create } from 'zustand';

import type {
  BiometricStatus,
  PinStatus,
  ImportPreview,
  ImportResult,
  ImportSource,
  LoginItemInput,
  LoginItemDetail,
  LoginItemSummary,
  LoginItemUpdate,
  PaymentCardInput,
  PaymentCardUpdate,
  PaymentCardSummary,
  PaymentCardDetail,
  SshCredentialInput,
  SshCredentialUpdate,
  SshCredentialSummary,
  SshCredentialDetail,
  IdentityInput,
  IdentityUpdate,
  IdentitySummary,
  IdentityDetail,
  SecretItemInput,
  SecretItemUpdate,
  SecretItemSummary,
  SecretItemDetail,
  VaultStatus,
} from '../../../shared/contracts';

interface VaultStore {
  ready: boolean;
  status: VaultStatus | null;
  items: LoginItemSummary[];
  cards: PaymentCardSummary[];
  sshCredentials: SshCredentialSummary[];
  identities: IdentitySummary[];
  secrets: SecretItemSummary[];
  busy: boolean;
  error: string | null;
  copiedId: string | null;
  biometric: BiometricStatus | null;
  pin: PinStatus | null;
  refresh(): Promise<void>;
  refreshBiometric(): Promise<void>;
  refreshPin(): Promise<void>;
  createVault(masterPassword: string): Promise<boolean>;
  unlockVault(masterPassword: string): Promise<boolean>;
  unlockWithBiometrics(): Promise<boolean>;
  unlockWithPin(pin: string): Promise<boolean>;
  enablePin(pin: string, failureLimit: number): Promise<boolean>;
  disablePin(): Promise<boolean>;
  enableBiometric(): Promise<boolean>;
  disableBiometric(): Promise<boolean>;
  lockVault(): Promise<boolean>;
  addItem(input: LoginItemInput): Promise<boolean>;
  updateItem(input: LoginItemUpdate): Promise<boolean>;
  getItemDetail(id: string): Promise<LoginItemDetail | null>;
  deleteItem(id: string): Promise<boolean>;
  deleteItems(ids: string[]): Promise<boolean>;
  copyPassword(id: string, masterPassword?: string): Promise<boolean>;
  addCard(input: PaymentCardInput): Promise<boolean>;
  updateCard(input: PaymentCardUpdate): Promise<boolean>;
  getCardDetail(id: string): Promise<PaymentCardDetail | null>;
  deleteCard(id: string): Promise<boolean>;
  copyCardSecret(id: string, kind: 'number' | 'securityCode' | 'pin', masterPassword?: string): Promise<boolean>;
  addSshCredential(input: SshCredentialInput): Promise<boolean>;
  updateSshCredential(input: SshCredentialUpdate): Promise<boolean>;
  getSshCredentialDetail(id: string): Promise<SshCredentialDetail | null>;
  deleteSshCredential(id: string): Promise<boolean>;
  copySshSecret(id: string, kind: 'password' | 'publicKey' | 'privateKey' | 'keyPassphrase', masterPassword?: string): Promise<boolean>;
  addIdentity(input: IdentityInput): Promise<boolean>;
  updateIdentity(input: IdentityUpdate): Promise<boolean>;
  getIdentityDetail(id: string): Promise<IdentityDetail | null>;
  deleteIdentity(id: string): Promise<boolean>;
  addSecret(input: SecretItemInput): Promise<boolean>;
  updateSecret(input: SecretItemUpdate): Promise<boolean>;
  getSecretDetail(id: string): Promise<SecretItemDetail | null>;
  deleteSecret(id: string): Promise<boolean>;
  copySecretValue(id: string, masterPassword?: string): Promise<boolean>;
  selectImport(source: ImportSource): Promise<ImportPreview | null>;
  commitImport(sessionId: string): Promise<ImportResult | null>;
  cancelImport(sessionId: string): Promise<void>;
  handleLocked(): void;
  clearError(): void;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : '操作失败。';
}

export const useVaultStore = create<VaultStore>((set, get) => {
  const run = async (operation: () => Promise<void>): Promise<boolean> => {
    set({ busy: true, error: null });
    try {
      await operation();
      return true;
    } catch (reason) {
      set({ error: messageOf(reason) });
      return false;
    } finally {
      set({ busy: false });
    }
  };

  const refresh = async (): Promise<void> => {
    try {
      const [status, biometric, pin] = await Promise.all([
        window.vaultMesh.vault.status(),
        window.vaultMesh.vault.biometricStatus(),
        window.vaultMesh.vault.pinStatus(),
      ]);
      const [items, cards, sshCredentials, identities, secrets] = status.unlocked
        ? await Promise.all([window.vaultMesh.items.list(), window.vaultMesh.cards.list(), window.vaultMesh.ssh.list(), window.vaultMesh.identities.list(), window.vaultMesh.secrets.list()])
        : [[], [], [], [], []];
      set({ status, biometric, pin, items, cards, sshCredentials, identities, secrets, copiedId: status.unlocked ? get().copiedId : null });
    } catch (reason) {
      set({ error: messageOf(reason) });
    } finally {
      set({ ready: true });
    }
  };

  return {
    ready: false,
    status: null,
    items: [],
    cards: [],
    sshCredentials: [],
    identities: [],
    secrets: [],
    busy: false,
    error: null,
    copiedId: null,
    biometric: null,
    pin: null,
    refresh,
    refreshBiometric: async () => {
      try {
        set({ biometric: await window.vaultMesh.vault.biometricStatus() });
      } catch (reason) {
        set({ error: messageOf(reason) });
      }
    },
    refreshPin: async () => {
      try {
        set({ pin: await window.vaultMesh.vault.pinStatus() });
      } catch (reason) {
        set({ error: messageOf(reason) });
      }
    },
    createVault: async (masterPassword) => {
      let created = false;
      const succeeded = await run(async () => {
        const result = await window.vaultMesh.vault.create({ masterPassword });
        if (!result.cancelled) {
          set({
            status: result.status,
            biometric: await window.vaultMesh.vault.biometricStatus(),
            pin: await window.vaultMesh.vault.pinStatus(),
            items: [],
            cards: [],
            sshCredentials: [],
            identities: [],
            secrets: [],
          });
          created = result.status.unlocked;
        }
      });
      return succeeded && created;
    },
    unlockVault: async (masterPassword) => {
      let unlocked = false;
      const succeeded = await run(async () => {
        const result = await window.vaultMesh.vault.unlock({ masterPassword });
        if (!result.cancelled) {
          const [items, cards, sshCredentials, identities, secrets] = result.status.unlocked
            ? await Promise.all([window.vaultMesh.items.list(), window.vaultMesh.cards.list(), window.vaultMesh.ssh.list(), window.vaultMesh.identities.list(), window.vaultMesh.secrets.list()])
            : [[], [], [], [], []];
          set({
            status: result.status,
            biometric: await window.vaultMesh.vault.biometricStatus(),
            pin: await window.vaultMesh.vault.pinStatus(),
            items,
            cards,
            sshCredentials,
            identities,
            secrets,
          });
          unlocked = result.status.unlocked;
        }
      });
      return succeeded && unlocked;
    },
    unlockWithBiometrics: async () => {
      let unlocked = false;
      const succeeded = await run(async () => {
        const result = await window.vaultMesh.vault.unlockWithBiometrics();
        if (!result.cancelled) {
          const [items, cards, sshCredentials, identities, secrets] = result.status.unlocked
            ? await Promise.all([window.vaultMesh.items.list(), window.vaultMesh.cards.list(), window.vaultMesh.ssh.list(), window.vaultMesh.identities.list(), window.vaultMesh.secrets.list()])
            : [[], [], [], [], []];
          set({ status: result.status, items, cards, sshCredentials, identities, secrets });
          unlocked = result.status.unlocked;
        }
      });
      return succeeded && unlocked;
    },
    unlockWithPin: async (pinValue) => {
      let unlocked = false;
      const succeeded = await run(async () => {
        const result = await window.vaultMesh.vault.unlockWithPin({ pin: pinValue });
        if (!result.cancelled) {
          const [items, cards, sshCredentials, identities, secrets] = result.status.unlocked
            ? await Promise.all([window.vaultMesh.items.list(), window.vaultMesh.cards.list(), window.vaultMesh.ssh.list(), window.vaultMesh.identities.list(), window.vaultMesh.secrets.list()])
            : [[], [], [], [], []];
          set({ status: result.status, items, cards, sshCredentials, identities, secrets });
          unlocked = result.status.unlocked;
        }
      });
      try { set({ pin: await window.vaultMesh.vault.pinStatus() }); } catch { /* Keep the unlock result. */ }
      return succeeded && unlocked;
    },
    enablePin: (pinValue, failureLimit) => run(async () => {
      set({ pin: await window.vaultMesh.vault.enablePin({ pin: pinValue, failureLimit }) });
    }),
    disablePin: () => run(async () => {
      set({ pin: await window.vaultMesh.vault.disablePin() });
    }),
    enableBiometric: async () => {
      const succeeded = await run(async () => {
        set({ biometric: await window.vaultMesh.vault.enableBiometric() });
      });
      return succeeded;
    },
    disableBiometric: async () => {
      const succeeded = await run(async () => {
        set({ biometric: await window.vaultMesh.vault.disableBiometric() });
      });
      return succeeded;
    },
    lockVault: () =>
      run(async () => {
        const status = await window.vaultMesh.vault.lock();
        set({ status, items: [], cards: [], sshCredentials: [], identities: [], secrets: [], copiedId: null });
      }),
    addItem: (input) =>
      run(async () => {
        await window.vaultMesh.items.add(input);
        set({ items: await window.vaultMesh.items.list() });
      }),
    updateItem: (input) =>
      run(async () => {
        await window.vaultMesh.items.update(input);
        set({ items: await window.vaultMesh.items.list() });
      }),
    getItemDetail: async (id) => {
      try {
        return await window.vaultMesh.items.detail(id);
      } catch (reason) {
        set({ error: messageOf(reason) });
        return null;
      }
    },
    deleteItem: (id) =>
      run(async () => {
        await window.vaultMesh.items.delete(id);
        set({ items: await window.vaultMesh.items.list() });
      }),
    deleteItems: (ids) =>
      run(async () => {
        const uniqueIds = [...new Set(ids)];
        try {
          for (const id of uniqueIds) {
            await window.vaultMesh.items.delete(id);
          }
        } finally {
          // Keep the list accurate even when a later item in a batch fails to delete.
          set({ items: await window.vaultMesh.items.list() });
        }
      }),
    copyPassword: async (id, masterPassword) => {
      const succeeded = await run(async () => {
        await window.vaultMesh.items.copyPassword(id, masterPassword);
        set({ copiedId: id });
        window.setTimeout(() => {
          set((state) => (state.copiedId === id ? { copiedId: null } : {}));
        }, 2_000);
      });
      return succeeded;
    },
    addCard: (input) =>
      run(async () => {
        await window.vaultMesh.cards.add(input);
        set({ cards: await window.vaultMesh.cards.list() });
      }),
    updateCard: (input) =>
      run(async () => {
        await window.vaultMesh.cards.update(input);
        set({ cards: await window.vaultMesh.cards.list() });
      }),
    getCardDetail: async (id) => {
      try { return await window.vaultMesh.cards.detail(id); }
      catch (reason) { set({ error: messageOf(reason) }); return null; }
    },
    deleteCard: (id) =>
      run(async () => {
        await window.vaultMesh.cards.delete(id);
        set({ cards: await window.vaultMesh.cards.list() });
      }),
    copyCardSecret: async (id, kind, masterPassword) => {
      const succeeded = await run(async () => {
        if (kind === 'number') await window.vaultMesh.cards.copyNumber(id, masterPassword);
        else if (kind === 'securityCode') await window.vaultMesh.cards.copySecurityCode(id, masterPassword);
        else await window.vaultMesh.cards.copyPin(id, masterPassword);
        set({ copiedId: id });
        window.setTimeout(() => {
          set((state) => (state.copiedId === id ? { copiedId: null } : {}));
        }, 2_000);
      });
      return succeeded;
    },
    addSshCredential: (input) => run(async () => {
      await window.vaultMesh.ssh.add(input);
      set({ sshCredentials: await window.vaultMesh.ssh.list() });
    }),
    updateSshCredential: (input) => run(async () => {
      await window.vaultMesh.ssh.update(input);
      set({ sshCredentials: await window.vaultMesh.ssh.list() });
    }),
    getSshCredentialDetail: async (id) => {
      try { return await window.vaultMesh.ssh.detail(id); }
      catch (reason) { set({ error: messageOf(reason) }); return null; }
    },
    deleteSshCredential: (id) => run(async () => {
      await window.vaultMesh.ssh.delete(id);
      set({ sshCredentials: await window.vaultMesh.ssh.list() });
    }),
    copySshSecret: async (id, kind, masterPassword) => {
      const succeeded = await run(async () => {
        if (kind === 'password') await window.vaultMesh.ssh.copyPassword(id, masterPassword);
        else if (kind === 'publicKey') await window.vaultMesh.ssh.copyPublicKey(id);
        else if (kind === 'privateKey') await window.vaultMesh.ssh.copyPrivateKey(id, masterPassword);
        else await window.vaultMesh.ssh.copyKeyPassphrase(id, masterPassword);
        set({ copiedId: id });
        window.setTimeout(() => set((state) => state.copiedId === id ? { copiedId: null } : {}), 2_000);
      });
      return succeeded;
    },
    addIdentity: (input) => run(async () => {
      await window.vaultMesh.identities.add(input);
      set({ identities: await window.vaultMesh.identities.list() });
    }),
    updateIdentity: (input) => run(async () => {
      await window.vaultMesh.identities.update(input);
      set({ identities: await window.vaultMesh.identities.list() });
    }),
    getIdentityDetail: async (id) => {
      try { return await window.vaultMesh.identities.detail(id); }
      catch (reason) { set({ error: messageOf(reason) }); return null; }
    },
    deleteIdentity: (id) => run(async () => {
      await window.vaultMesh.identities.delete(id);
      set({ identities: await window.vaultMesh.identities.list() });
    }),
    addSecret: (input) => run(async () => {
      await window.vaultMesh.secrets.add(input);
      set({ secrets: await window.vaultMesh.secrets.list() });
    }),
    updateSecret: (input) => run(async () => {
      await window.vaultMesh.secrets.update(input);
      set({ secrets: await window.vaultMesh.secrets.list() });
    }),
    getSecretDetail: async (id) => {
      try { return await window.vaultMesh.secrets.detail(id); }
      catch (reason) { set({ error: messageOf(reason) }); return null; }
    },
    deleteSecret: (id) => run(async () => {
      await window.vaultMesh.secrets.delete(id);
      set({ secrets: await window.vaultMesh.secrets.list() });
    }),
    copySecretValue: async (id, masterPassword) => {
      const succeeded = await run(async () => {
        await window.vaultMesh.secrets.copyValue(id, masterPassword);
        set({ copiedId: id });
        window.setTimeout(() => set((state) => state.copiedId === id ? { copiedId: null } : {}), 2_000);
      });
      return succeeded;
    },
    selectImport: async (source) => {
      let preview: ImportPreview | null = null;
      const succeeded = await run(async () => {
        preview = await window.vaultMesh.imports.select(source);
      });
      return succeeded ? preview : null;
    },
    commitImport: async (sessionId) => {
      let result: ImportResult | null = null;
      const succeeded = await run(async () => {
        result = await window.vaultMesh.imports.commit(sessionId);
        const [items, cards, sshCredentials, identities, secrets, status] = await Promise.all([
          window.vaultMesh.items.list(),
          window.vaultMesh.cards.list(),
          window.vaultMesh.ssh.list(),
          window.vaultMesh.identities.list(),
          window.vaultMesh.secrets.list(),
          window.vaultMesh.vault.status(),
        ]);
        set({ items, cards, sshCredentials, identities, secrets, status });
      });
      return succeeded ? result : null;
    },
    cancelImport: async (sessionId) => {
      try {
        await window.vaultMesh.imports.cancel(sessionId);
      } catch (reason) {
        set({ error: messageOf(reason) });
      }
    },
    handleLocked: () => {
      const current = get().status;
      set({
        status: {
          unlocked: false,
          hasVault: current?.hasVault ?? true,
          itemCount: current?.itemCount ?? 0,
        },
        items: [],
        cards: [],
        sshCredentials: [],
        identities: [],
        secrets: [],
        copiedId: null,
        busy: false,
      });
    },
    clearError: () => set({ error: null }),
  };
});
