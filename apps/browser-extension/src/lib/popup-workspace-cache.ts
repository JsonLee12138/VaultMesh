import { z } from "zod";

import { workspaceSchema, type WorkspaceSnapshot } from "@/lib/desktop-rpc";

const workspaceRpcResponseSchema = z.object({
  kind: z.literal("vaultmesh.rpc-result"),
  version: z.literal(2),
  requestId: z.string().uuid(),
  ok: z.literal(true),
  result: workspaceSchema,
});

const statusRpcResponseSchema = z.object({
  kind: z.literal("vaultmesh.rpc-result"),
  version: z.literal(2),
  requestId: z.string().uuid(),
  ok: z.literal(true),
  result: z.object({ unlocked: z.boolean() }),
});

export type PopupWorkspaceCacheEntry = {
  snapshot: WorkspaceSnapshot;
  cachedAt: number;
};

/** Volatile background-only cache. It is never written to extension storage. */
export class PopupWorkspaceMemoryCache {
  #entry: PopupWorkspaceCacheEntry | null = null;

  read(): PopupWorkspaceCacheEntry | null {
    return this.#entry;
  }

  clear(): void {
    this.#entry = null;
  }

  storeSnapshot(snapshot: unknown, now = Date.now()): void {
    const parsed = workspaceSchema.safeParse(snapshot);
    if (parsed.success) this.#entry = { snapshot: parsed.data, cachedAt: now };
  }

  observeRpcResponse(operation: string, response: unknown, now = Date.now()): void {
    if (operation === "vault.workspace") {
      const parsed = workspaceRpcResponseSchema.safeParse(response);
      if (parsed.success) this.storeSnapshot(parsed.data.result, now);
      return;
    }
    if (operation === "vault.status") {
      const parsed = statusRpcResponseSchema.safeParse(response);
      if (parsed.success && !parsed.data.result.unlocked) this.clear();
    }
  }
}
