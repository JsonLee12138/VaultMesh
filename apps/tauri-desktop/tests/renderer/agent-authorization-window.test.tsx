// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentAuthorizationWindow } from '../../src/agent-authorization';

const { hide, invoke, listeners } = vi.hoisted(() => ({
  hide: vi.fn(),
  invoke: vi.fn(),
  listeners: new Map<string, () => void>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, callback: () => void) => {
    listeners.set(event, callback);
    return () => listeners.delete(event);
  }),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ hide }) }));

const permission = {
  permissionRef: '22222222-2222-4222-8222-222222222222',
  clientId: '33333333-3333-4333-8333-333333333333',
  sessionId: '44444444-4444-4444-8444-444444444444',
  accountRef: '11111111-1111-4111-8111-111111111111',
  accountLabel: 'Unraid',
  environment: 'default',
  tool: 'vaultmesh_ssh_exec',
  operation: 'hostname',
  risk: 'R1',
  approvedDisplay: 'root@10.0.0.2:22 · SHA256:6LULz/JSkVsYf3FumqkR8ATBeZm/ruuA8PaXP0Hsp98',
  actionDisplay: 'hostname',
  sourceItemRef: '11111111-1111-4111-8111-111111111111',
  sourceItemKind: 'ssh',
  activationRequired: true,
  availableScopes: ['exact', 'safe', 'all'],
  availableAllowDurations: ['once', 'connection', 'permanent'],
  availableDenyDurations: ['once', 'connection', 'permanent'],
  recommendedScope: 'safe',
  recommendedDuration: 'connection',
  freshConfirmationRequired: false,
  createdAt: 1_000,
  expiresAt: 31_000,
} as const;

describe('CT-AGENT-AUTHZ-002 isolated authorization window', () => {
  beforeEach(() => {
    invoke.mockReset();
    hide.mockReset();
    listeners.clear();
    invoke.mockImplementation(async (command: string) => {
      if (command === 'agent_authorization_status') {
        return {
          now: 1_000,
          executionExpiresAt: 31_000,
          request: { kind: 'permission', clientKey: 'codex', expiresAt: 901_000, permission: { ...permission, expiresAt: 901_000 } },
        };
      }
      return { request: permission, choice: { effect: 'allow', scope: 'exact', duration: 'once' } };
    });
  });

  afterEach(() => cleanup());

  it('shows scope and duration choices and applies the broker recommendation', async () => {
    const { container } = render(<AgentAuthorizationWindow />);

    const title = await screen.findByText('codex 请求动作授权');
    expect(title.parentElement?.querySelector('svg')).toBeTruthy();
    expect(container.querySelector('[data-slot^="card"]')).toBeNull();
    expect(container.querySelector('main')?.className).toContain('min-h-svh');
    expect(container.querySelector('main > footer')).toBeTruthy();
    expect(container.querySelector('main > [role="progressbar"]')).toBeTruthy();
    expect(screen.getByText('账号：Unraid')).toBeTruthy();
    expect(screen.getByText('root@10.0.0.2:22')).toBeTruthy();
    expect(screen.queryByText(/SHA256:/)).toBeNull();
    expect(screen.getByText('R1 · 读取')).toBeTruthy();
    const toolType = screen.getByText('工具类型');
    const target = screen.getByText('目标');
    expect(toolType.parentElement?.parentElement).toBe(target.parentElement?.parentElement);
    expect(screen.getByText('SSH 命令')).toBeTruthy();
    expect(screen.getByText('hostname').closest('pre')).toBeTruthy();
    expect(screen.getByText('本次调用剩余 30 秒')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: '本次调用授权剩余时间' })).toBeTruthy();
    const scope = screen.getByLabelText('授权范围');
    const duration = screen.getByLabelText('有效时长');
    expect(scope.textContent).toContain('安全命令');
    expect(duration.textContent).toContain('本次 Agent 连接');
    expect(scope.parentElement?.parentElement).toBe(duration.parentElement?.parentElement);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '拒绝',
      '允许',
    ]);

    fireEvent.click(screen.getByRole('button', { name: '允许' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'agent_authorization_resolve_permission',
      {
        input: {
          permissionRef: permission.permissionRef,
          choice: { effect: 'allow', scope: 'safe', duration: 'connection' },
        },
      },
    ));
    await waitFor(() => expect(hide).toHaveBeenCalled());
  });

  it('never shows a SHA256 target suffix for non-SSH permissions', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'agent_authorization_status') {
        return {
          now: 1_000,
          executionExpiresAt: 31_000,
          request: {
            kind: 'permission',
            clientKey: 'codex',
            expiresAt: 901_000,
            permission: {
              ...permission,
              tool: 'vaultmesh_http_request',
              operation: 'status',
              approvedDisplay: 'https://api.example.test · SHA256:6LULz/JSkVsYf3FumqkR8ATBeZm/ruuA8PaXP0Hsp98',
              actionDisplay: 'GET /status',
              availableScopes: ['exact'],
              availableAllowDurations: ['once'],
              availableDenyDurations: ['once'],
              recommendedScope: 'exact',
              recommendedDuration: 'once',
              expiresAt: 901_000,
            },
          },
        };
      }
      return { request: permission, choice: { effect: 'allow', scope: 'exact', duration: 'once' } };
    });

    render(<AgentAuthorizationWindow />);

    expect(await screen.findByText('https://api.example.test')).toBeTruthy();
    expect(screen.queryByText(/SHA256:/i)).toBeNull();
  });

  it('falls back to the SSH host when the account has no name', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'agent_authorization_status') {
        return {
          now: 1_000,
          executionExpiresAt: 31_000,
          request: { kind: 'permission', clientKey: 'codex', expiresAt: 901_000, permission: { ...permission, accountLabel: '' as typeof permission.accountLabel } },
        };
      }
      return { request: permission, choice: { effect: 'allow', scope: 'exact', duration: 'once' } };
    });

    render(<AgentAuthorizationWindow />);

    expect(await screen.findByText('账号：10.0.0.2')).toBeTruthy();
  });

  it('immediately drains progress on the broker timeout and maps once to the next call', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'agent_authorization_status') {
        return {
          now: 1_000,
          executionExpiresAt: 31_000,
          request: {
            kind: 'permission',
            clientKey: 'codex',
            expiresAt: 901_000,
            permission: { ...permission, recommendedScope: 'exact', recommendedDuration: 'once', expiresAt: 901_000 },
          },
        };
      }
      return { request: permission, choice: { effect: 'allow', scope: 'exact', duration: 'once' } };
    });
    render(<AgentAuthorizationWindow />);

    expect(await screen.findByText('本次调用剩余 30 秒')).toBeTruthy();
    await waitFor(() => expect(listeners.has('agent-authorization-expired')).toBe(true));
    act(() => listeners.get('agent-authorization-expired')?.());

    expect(await screen.findByText('当前授权仅能下次调用使用')).toBeTruthy();
    expect(screen.getByText(/仅允许下一次执行一次/)).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: '本次调用授权剩余时间' }).getAttribute('aria-valuenow')).toBe('0');
    expect(hide).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '允许下一次' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'agent_authorization_resolve_permission',
      {
        input: {
          permissionRef: permission.permissionRef,
          choice: { effect: 'allow', scope: 'exact', duration: 'once' },
        },
      },
    ));
  });

  it('re-enables every action when the persistent window receives a second request', async () => {
    render(<AgentAuthorizationWindow />);

    fireEvent.click(await screen.findByRole('button', { name: '允许' }));
    await waitFor(() => expect(hide).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listeners.has('agent-authorization-requested')).toBe(true));

    act(() => listeners.get('agent-authorization-requested')?.());

    const allow = await screen.findByRole('button', { name: '允许' });
    expect(allow.hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: '拒绝' }).hasAttribute('disabled')).toBe(false);

    fireEvent.click(allow);
    await waitFor(() => {
      const resolutions = invoke.mock.calls.filter(([command]) => command === 'agent_authorization_resolve_permission');
      expect(resolutions).toHaveLength(2);
    });
  });

  it.each([
    ['R0', 'risk-r0', 'R0 · 元数据'],
    ['R1', 'risk-r1', 'R1 · 读取'],
    ['R2', 'risk-r2', 'R2 · 变更'],
    ['R3', 'risk-r3', 'R3 · 高权限'],
    ['R4', 'risk-r4', 'R4 · 破坏性'],
  ] as const)('uses the unified permission layout and risk-colored Allow for %s', async (risk, variant, label) => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'agent_authorization_status') {
        return {
          now: 1_000,
          executionExpiresAt: 31_000,
          request: {
            kind: 'permission',
            clientKey: 'codex',
            expiresAt: 901_000,
            permission: {
              ...permission,
              risk,
              actionDisplay: risk === 'R3' ? "sudo 'systemctl' 'restart' 'vaultmesh'" : 'hostname',
              availableScopes: risk === 'R3' || risk === 'R4' ? ['exact'] : permission.availableScopes,
              availableAllowDurations: risk === 'R4' ? ['once'] : permission.availableAllowDurations,
              recommendedScope: risk === 'R1' ? 'safe' : 'exact',
              recommendedDuration: risk === 'R1' ? 'connection' : 'once',
              freshConfirmationRequired: risk === 'R2' || risk === 'R3' || risk === 'R4',
              expiresAt: 901_000,
            },
          },
        };
      }
      return { request: permission, choice: { effect: 'allow', scope: 'exact', duration: 'once' } };
    });

    const { container } = render(<AgentAuthorizationWindow />);

    const title = await screen.findByText('codex 请求动作授权');
    expect(title.parentElement?.querySelector('svg')).toBeTruthy();
    expect(container.querySelector('[data-slot^="card"]')).toBeNull();
    expect(container.querySelector('main > footer')).toBeTruthy();
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByRole('button', { name: '允许' }).getAttribute('data-variant')).toBe(variant);
    expect(screen.queryByRole('button', { name: '确认执行' })).toBeNull();
    expect(screen.getByLabelText('有效时长').textContent).toContain(risk === 'R1' ? '本次 Agent 连接' : '仅本次');
  });
});
