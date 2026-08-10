import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

export async function verifyBrowserHost({
  nativeHostPath,
  extensionId,
  timeoutMs = 10_000,
}) {
  if (!nativeHostPath || !/^[a-p]{32}$/.test(extensionId)) {
    throw new Error('Rust Host probe 缺少有效的路径或扩展 ID。');
  }

  return verifyBrowserHostLaunch({
    nativeHostPath,
    launchArguments: [`chrome-extension://${extensionId}/`],
    timeoutMs,
  });
}

export async function verifyFirefoxBrowserHost({
  nativeHostPath,
  manifestPath,
  extensionId,
  timeoutMs = 10_000,
}) {
  if (!nativeHostPath || !manifestPath || extensionId !== 'vaultmesh@atlantis-mk.github.io') {
    throw new Error('Firefox Rust Host probe 缺少有效路径或固定 Gecko ID。');
  }
  return verifyBrowserHostLaunch({
    nativeHostPath,
    launchArguments: [manifestPath, extensionId],
    timeoutMs,
  });
}

async function verifyBrowserHostLaunch({ nativeHostPath, launchArguments, timeoutMs }) {
  const now = Date.now();
  const requestId = randomUUID();
  const request = Buffer.from(JSON.stringify({
    kind: 'vaultmesh.rpc',
    version: 2,
    requestId,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    operation: 'vault.status',
    input: {},
  }));
  const frame = Buffer.alloc(4 + request.length);
  frame.writeUInt32LE(request.length, 0);
  request.copy(frame, 4);

  const output = await communicate(
    nativeHostPath,
    launchArguments,
    frame,
    timeoutMs,
  );
  if (output.length < 5) throw new Error('Rust Native Host 未返回有效响应。');
  const length = output.readUInt32LE(0);
  if (length > output.length - 4) throw new Error('Rust Native Host 返回了截断响应。');
  const response = JSON.parse(output.subarray(4, 4 + length).toString('utf8'));
  if (response.kind !== 'vaultmesh.rpc-result'
    || response.requestId !== requestId
    || response.ok !== true) {
    throw new Error(`Rust Native Host 往返失败：${response.status ?? response.error?.code ?? 'invalid-response'}`);
  }
}

function communicate(command, args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = [];
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) child.kill();
      callback(value);
    };
    const timer = setTimeout(() => {
      settle(reject, new Error('Rust Native Host 往返超时。'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      chunks.push(chunk);
      const output = Buffer.concat(chunks);
      if (output.length < 4) return;
      const length = output.readUInt32LE(0);
      if (output.length < 4 + length) return;
      settle(resolve, output.subarray(0, 4 + length));
    });
    child.once('error', (error) => {
      settle(reject, error);
    });
    child.once('exit', (code) => {
      if (settled) return;
      if (code === 0) settle(resolve, Buffer.concat(chunks));
      else settle(reject, new Error(`Rust Native Host 退出码 ${code ?? 1}`));
    });
    child.stdin.end(input);
  });
}
