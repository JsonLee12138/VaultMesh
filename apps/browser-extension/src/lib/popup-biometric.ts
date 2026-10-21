import { z } from "zod";
import { desktopRpc } from "./desktop-rpc";

export const biometricStatusSchema = z.object({ available: z.boolean(), enabled: z.boolean(), followsDesktop: z.boolean().optional() });
const phaseSchema = z.discriminatedUnion("phase", [z.object({ phase: z.literal("waiting") }), z.object({ phase: z.literal("unlocked") })]);

/** One popup lifetime only. Never retries a start or resumes an abandoned authentication. */
export async function authenticatePopup(signal: AbortSignal): Promise<void> {
  const sessionId = crypto.randomUUID();
  const input = { sessionId };
  const cancel = () => { void desktopRpc("biometric.authentication.cancel", input).catch(() => undefined); };
  signal.throwIfAborted();
  signal.addEventListener("abort", cancel, { once: true });
  const timeout = AbortSignal.timeout(30_000);
  const lifetime = AbortSignal.any([signal, timeout]);
  timeout.addEventListener("abort", cancel, { once: true });
  // Race each transport wait against popup cancellation and the overall deadline.
  async function wait<T>(promise: Promise<T>): Promise<T> {
    lifetime.throwIfAborted();
    let abort: () => void = () => undefined;
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => {
        abort = () => reject(lifetime.reason);
        lifetime.addEventListener("abort", abort, { once: true });
      })]);
    } finally { lifetime.removeEventListener("abort", abort); }
  }
  try {
    phaseSchema.parse(await wait(desktopRpc("biometric.authentication.start", input)));
    for (;;) {
      lifetime.throwIfAborted();
      const result = phaseSchema.parse(await wait(desktopRpc("biometric.authentication.poll", input)));
      lifetime.throwIfAborted();
      if (result.phase === "unlocked") return;
      await wait(new Promise<void>((resolve) => setTimeout(resolve, 250)));
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    timeout.removeEventListener("abort", cancel);
    cancel();
  }
}
