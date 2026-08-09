import type { CapturedSecret } from "@/lib/save-capture";

export type CapturedSecretAddInput = CapturedSecret & {
  notes: null;
  folder: null;
  favorite: false;
  masterPasswordReprompt: false;
};

export function capturedSecretAddInput(secret: CapturedSecret): CapturedSecretAddInput {
  return {
    ...secret,
    notes: null,
    folder: null,
    favorite: false,
    masterPasswordReprompt: false,
  };
}
