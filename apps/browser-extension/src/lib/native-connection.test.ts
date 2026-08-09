import { afterEach, describe, expect, it, vi } from "vitest";

import { PersistentNativeConnection, type NativeRpcRequest } from "./native-connection";

type Listener<T> = (value: T) => void;

function fakePort() {
  const messageListeners: Listener<unknown>[] = [];
  const disconnectListeners: Array<() => void> = [];
  return {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: { addListener: (listener: Listener<unknown>) => messageListeners.push(listener) },
    onDisconnect: { addListener: (listener: () => void) => disconnectListeners.push(listener) },
    emitMessage: (message: unknown) => messageListeners.forEach((listener) => listener(message)),
    emitDisconnect: () => disconnectListeners.forEach((listener) => listener()),
  };
}

function request(requestId: string): NativeRpcRequest {
  return {
    kind: "vaultmesh.rpc",
    version: 2,
    requestId,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    operation: "vault.status",
    input: {},
  };
}

describe("persistent native connection", () => {
  afterEach(() => vi.useRealTimers());

  it("reuses one port and correlates concurrent responses", async () => {
    const port = fakePort();
    const connect = vi.fn(() => port as never);
    const connection = new PersistentNativeConnection(connect);
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();

    const first = connection.request(request(firstId));
    const second = connection.request(request(secondId));
    expect(connect).toHaveBeenCalledTimes(1);
    expect(port.postMessage).toHaveBeenCalledTimes(2);

    const secondResponse = { kind: "vaultmesh.rpc-result", requestId: secondId, ok: true };
    const firstResponse = { kind: "vaultmesh.rpc-result", requestId: firstId, ok: true };
    port.emitMessage(secondResponse);
    port.emitMessage(firstResponse);

    await expect(first).resolves.toEqual(firstResponse);
    await expect(second).resolves.toEqual(secondResponse);
    connection.dispose();
  });

  it("rejects in-flight work and reconnects after the port disconnects", async () => {
    vi.useFakeTimers();
    const firstPort = fakePort();
    const secondPort = fakePort();
    const connect = vi.fn()
      .mockReturnValueOnce(firstPort as never)
      .mockReturnValueOnce(secondPort as never);
    const connection = new PersistentNativeConnection(connect);
    const onDisconnected = vi.fn();
    connection.onDisconnected(onDisconnected);
    const pending = connection.request(request(crypto.randomUUID()));

    firstPort.emitDisconnect();
    await expect(pending).rejects.toThrow("desktop-unavailable");
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(connect).toHaveBeenCalledTimes(2);

    connection.dispose();
  });
});
