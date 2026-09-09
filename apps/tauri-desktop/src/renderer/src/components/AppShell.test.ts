import { describe, expect, it } from 'vitest';

import { agentPairingUsesMainWindow, getVaultPageHeader, isFocusedItemEditor, isFocusedLoginEditor, usesViewportShell } from './AppShell';

describe('CT-AGENT-CODEX-001 local Agent UI routing', () => {
  it('keeps first-time Agent pairing out of the main window', () => {
    expect(agentPairingUsesMainWindow()).toBe(false);
  });
});

describe('CT-LAN-PAIRING-001 nearby devices routing', () => {
  it('uses a dedicated security subpage without implying sync', () => {
    const header = getVaultPageHeader('/nearby');
    expect(header?.title).toBe('附近设备');
    expect(header?.description).not.toContain('同步');
  });
});

describe('login editor shell layout', () => {
  it('uses the focused viewport shell only for login editors', () => {
    expect(isFocusedLoginEditor('/vault/items/new')).toBe(true);
    expect(isFocusedLoginEditor('/vault/items/0d046d32-12cf-4d18-96a6-ae2ec09ba17f')).toBe(true);
    expect(isFocusedLoginEditor('/vault')).toBe(false);
    expect(isFocusedLoginEditor('/vault/cards/new')).toBe(false);
  });

  it('uses the same focused shell for every supported item editor', () => {
    expect(isFocusedItemEditor('/vault/items/new')).toBe(true);
    expect(isFocusedItemEditor('/vault/cards/card-id')).toBe(true);
    expect(isFocusedItemEditor('/vault/ssh/new')).toBe(true);
    expect(isFocusedItemEditor('/vault/identities/identity-id')).toBe(true);
    expect(isFocusedItemEditor('/vault/secrets/new')).toBe(true);
    expect(isFocusedItemEditor('/vault/services')).toBe(false);
  });

  it('bounds the service hub to the viewport for independent pane scrolling', () => {
    expect(usesViewportShell('/vault/services')).toBe(true);
    expect(usesViewportShell('/vault/items/new')).toBe(true);
    expect(usesViewportShell('/vault')).toBe(false);
  });
});
