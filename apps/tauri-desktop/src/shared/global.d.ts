import type { VaultMeshApi } from './api';

declare global {
  interface Window {
    vaultMesh: VaultMeshApi;
  }
}

export {};
