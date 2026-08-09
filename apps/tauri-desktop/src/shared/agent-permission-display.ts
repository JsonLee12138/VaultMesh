import type { AgentPermissionRequest } from './contracts';

export const AGENT_RISK_LABELS = {
  R0: 'R0 · 元数据',
  R1: 'R1 · 读取',
  R2: 'R2 · 变更',
  R3: 'R3 · 高权限',
  R4: 'R4 · 破坏性',
} as const satisfies Record<AgentPermissionRequest['risk'], string>;

type AgentPermissionDisplayInput = Pick<AgentPermissionRequest, 'accountLabel' | 'approvedDisplay' | 'operation' | 'tool'>;

const SHA256_DISPLAY_TOKEN = /(?:^|[\s·|,])sha256:[^\s·|,]*/giu;

function hideSha256FromDisplay(value: string): string {
  const sanitized = value
    .replace(SHA256_DISPLAY_TOKEN, '')
    .replace(/\s*·\s*$/u, '')
    .trim();
  return sanitized || '未知目标';
}

function sshHostFallback(approvedDisplay: string): string {
  const endpoint = approvedDisplay.split(' · ', 1)[0] ?? '';
  const atIndex = endpoint.lastIndexOf('@');
  const hostAndPort = atIndex >= 0 ? endpoint.slice(atIndex + 1) : endpoint;
  const portSeparator = hostAndPort.lastIndexOf(':');
  const host = portSeparator > 0 ? hostAndPort.slice(0, portSeparator) : hostAndPort;
  return host.trim();
}

export function formatAgentPermissionDisplay(permission: AgentPermissionDisplayInput): string {
  if (permission.tool === 'vaultmesh_ssh_exec') {
    const accountLabel = permission.accountLabel.trim() || sshHostFallback(permission.approvedDisplay);
    return `账号：${accountLabel || '未知主机'}`;
  }

  return `${permission.accountLabel} · ${permission.tool}${permission.operation ? ` / ${permission.operation}` : ''}`;
}

export function formatAgentPermissionTarget(permission: Pick<AgentPermissionRequest, 'approvedDisplay' | 'tool'>): string {
  return hideSha256FromDisplay(permission.approvedDisplay);
}

export function formatAgentToolType(tool: AgentPermissionRequest['tool']): string {
  if (tool === 'vaultmesh_ssh_exec') return 'SSH 命令';
  if (tool.startsWith('vaultmesh_ssh_')) return 'SSH 操作';
  if (tool.startsWith('vaultmesh_http_')) return 'HTTP 请求';
  if (tool.startsWith('vaultmesh_web_')) return '受控网页操作';
  if (tool.startsWith('vaultmesh_passkey_') || tool.startsWith('vaultmesh_credential_') || tool === 'vaultmesh_otp_fill' || tool === 'vaultmesh_recovery_code_consume') return '受保护认证';
  if (tool === 'vaultmesh_local_file_select' || tool === 'vaultmesh_result_save') return '本地文件操作';
  return tool;
}
