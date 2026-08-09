import { useSyncExternalStore } from 'react';

import type { SshExternalClientId } from '../../../shared/contracts';

const STORAGE_KEY = 'vaultmesh.ssh.preferredExternalClient';
const CHANGE_EVENT = 'vaultmesh:ssh-preferred-external-client-change';
const DEFAULT_CLIENT: SshExternalClientId = 'systemTerminal';
const CLIENT_IDS = new Set<SshExternalClientId>(['systemTerminal', 'vscode', 'copyCommand']);

function readPreferredClient(): SshExternalClientId {
  if (typeof window === 'undefined') return DEFAULT_CLIENT;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored && CLIENT_IDS.has(stored as SshExternalClientId) ? stored as SshExternalClientId : DEFAULT_CLIENT;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

export function usePreferredSshExternalClient(): SshExternalClientId {
  return useSyncExternalStore(subscribe, readPreferredClient, () => DEFAULT_CLIENT);
}

export function setPreferredSshExternalClient(clientId: SshExternalClientId): void {
  window.localStorage.setItem(STORAGE_KEY, clientId);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
