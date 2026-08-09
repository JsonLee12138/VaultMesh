// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentPairingWindow } from '../../src/agent-pairing';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => undefined),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ close: vi.fn() }),
}));

describe('Agent pairing window layout', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({
      request: {
        clientId: '11111111-1111-4111-8111-111111111111',
        clientKey: 'codex',
        connectedAt: 1_000,
      },
    });
  });

  afterEach(() => cleanup());

  it('uses the entire window instead of nesting the content in a card', async () => {
    const { container } = render(<AgentPairingWindow />);

    const title = await screen.findByText('codex 请求配对');
    expect(title.parentElement?.querySelector('svg')).toBeTruthy();
    expect(container.querySelector('[data-slot^="card"]')).toBeNull();
    expect(container.querySelector('main')?.className).toContain('min-h-svh');
    expect(container.querySelector('main > footer')).toBeTruthy();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '允许配对' })).toBeTruthy();
  });
});
