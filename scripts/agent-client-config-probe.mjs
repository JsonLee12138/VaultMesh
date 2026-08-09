import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: environment,
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (result.error) throw result.error;
  return result;
}

function requireSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
}

const codexVersion = run('codex', ['--version']);
requireSuccess(codexVersion, 'Codex availability');
const codex = run('codex', [
  'mcp',
  'list',
  '-c',
  'mcp_servers.vaultmesh.command="/bin/false"',
  '-c',
  'mcp_servers.vaultmesh.args=["--client","codex"]',
  '-c',
  'mcp_servers.vaultmesh.required=true',
  '-c',
  'mcp_servers.vaultmesh.default_tools_approval_mode="prompt"',
]);
requireSuccess(codex, 'Codex MCP config probe');
if (!codex.stdout.includes('vaultmesh') || !codex.stdout.includes('--client codex')) {
  throw new Error(`Codex did not resolve the VaultMesh stdio config: ${codex.stdout}`);
}

const probeRoot = await mkdtemp(join(tmpdir(), 'vaultmesh-agent-clients-'));
try {
  const openCodeConfig = join(probeRoot, 'opencode.json');
  await writeFile(
    openCodeConfig,
    JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        mcp: {
          vaultmesh: {
            type: 'local',
            command: ['/bin/false', '--client', 'opencode'],
            enabled: true,
            timeout: 5000,
          },
        },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  const openCodeVersion = run('opencode', ['--version']);
  requireSuccess(openCodeVersion, 'OpenCode availability');
  const openCode = run('opencode', ['mcp', 'list', '--pure'], {
    ...process.env,
    OPENCODE_CONFIG: openCodeConfig,
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
  });
  requireSuccess(openCode, 'OpenCode MCP config probe');
  if (!openCode.stdout.includes('vaultmesh')) {
    throw new Error(`OpenCode did not resolve the VaultMesh stdio config: ${openCode.stdout}`);
  }

  process.stdout.write(
    JSON.stringify(
      {
        codex: codexVersion.stdout.trim(),
        openCode: openCodeVersion.stdout.trim(),
        codexConfig: 'accepted',
        openCodeConfig: 'accepted',
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await rm(probeRoot, { recursive: true, force: true });
}
