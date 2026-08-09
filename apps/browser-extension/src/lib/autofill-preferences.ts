import { z } from "zod";

const preferenceSchema = z.object({ id: z.string().uuid() });
const KEY_PREFIX = "vaultmesh.autofill.last-login.v1:";

export async function rememberLoginSelection(topOrigin: string, id: string): Promise<void> {
  const key = preferenceKey(topOrigin);
  if (!key || !z.string().uuid().safeParse(id).success) return;
  await browser.storage.local.set({ [key]: { id } });
}

export async function rememberedLoginSelection(topOrigin: string): Promise<string | null> {
  const key = preferenceKey(topOrigin);
  if (!key) return null;
  try {
    const stored = await browser.storage.local.get(key);
    const parsed = preferenceSchema.safeParse(stored[key]);
    return parsed.success ? parsed.data.id : null;
  } catch {
    return null;
  }
}

function preferenceKey(topOrigin: string): string | null {
  try {
    const url = new URL(topOrigin);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== topOrigin) return null;
    return `${KEY_PREFIX}${url.origin}`;
  } catch {
    return null;
  }
}
