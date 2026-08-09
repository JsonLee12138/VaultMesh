type SendMessage = (message: unknown) => Promise<unknown>;

export function createContentScriptMessageSender(sendMessage: SendMessage, onContextInvalidated: () => void): SendMessage {
  let contextInvalidated = false;

  return async (message) => {
    if (contextInvalidated) return undefined;
    try {
      return await sendMessage(message);
    } catch (error) {
      if (!contextInvalidated && isExtensionContextInvalidatedError(error)) {
        contextInvalidated = true;
        onContextInvalidated();
      }
      return undefined;
    }
  };
}

export function registerContentScriptMessageListener<TListener>(
  addListener: (listener: TListener) => void,
  listener: TListener,
  onContextInvalidated: () => void,
): boolean {
  try {
    addListener(listener);
    return true;
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) throw error;
    onContextInvalidated();
    return false;
  }
}

export function isExtensionContextInvalidatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /extension context invalidated/i.test(message);
}
