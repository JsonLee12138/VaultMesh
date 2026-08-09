// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailOtpPage } from '../../src/renderer/src/pages/EmailOtpPage';
import type { VaultMeshApi } from '../../src/shared/api';
import { DEFAULT_EMAIL_OTP_SETTINGS } from '../../src/shared/contracts';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const candidate = {
  accountId: '4f3621b7-8dc4-43c9-9a29-b111bf48e35a',
  accountAddress: 'ada@example.test',
  code: 'A9b2C3',
  sender: 'security@example.test',
  subject: 'Your verification code',
  receivedAt: 1_700_000_000,
};

describe('Email OTP page', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'vaultMesh', {
      configurable: true,
      value: {
        emailOtp: {
          accounts: vi.fn().mockResolvedValue([]),
          settings: vi.fn().mockResolvedValue(DEFAULT_EMAIL_OTP_SETTINGS),
          oauthAvailability: vi.fn().mockResolvedValue({ gmail: false, outlook: false }),
          copyCode: vi.fn(),
          onCandidates: vi.fn().mockReturnValue(vi.fn()),
        },
      } as unknown as VaultMeshApi,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders each reading setting with a visible state track and right-aligned field content', async () => {
    render(<EmailOtpPage />);

    await waitFor(() => expect(window.vaultMesh.emailOtp.settings).toHaveBeenCalledOnce());

    for (const name of ['启用连续增量监听', '仅扫描未读邮件']) {
      const control = screen.getByRole('switch', { name });
      const field = control.closest('[data-slot="field"]');

      expect(control.className).toContain('data-[state=checked]:bg-primary');
      expect(control.className).toContain('data-[state=unchecked]:bg-input');
      expect(field?.querySelector('[data-slot="field-content"]')).toBeTruthy();
    }
    expect(screen.queryByRole('switch', { name: '要求站点域名匹配' })).toBeNull();
  });

  it('copies a recent verification code and reports success', async () => {
    vi.mocked(window.vaultMesh.emailOtp.onCandidates).mockImplementation((callback) => {
      callback([candidate]);
      return vi.fn();
    });
    vi.mocked(window.vaultMesh.emailOtp.copyCode).mockResolvedValue({ clearsAt: Date.now() + 30_000 });
    render(<EmailOtpPage />);

    fireEvent.click(await screen.findByRole('button', { name: '复制验证码 A9b2C3' }));

    await waitFor(() => expect(window.vaultMesh.emailOtp.copyCode).toHaveBeenCalledWith('A9b2C3'));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('验证码已复制'));
  });

  it('shows the backend error when copying a recent verification code fails', async () => {
    vi.mocked(window.vaultMesh.emailOtp.onCandidates).mockImplementation((callback) => {
      callback([candidate]);
      return vi.fn();
    });
    vi.mocked(window.vaultMesh.emailOtp.copyCode).mockRejectedValue(new Error('无法写入剪贴板。'));
    render(<EmailOtpPage />);

    fireEvent.click(await screen.findByRole('button', { name: '复制验证码 A9b2C3' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('无法写入剪贴板。'));
  });
});
