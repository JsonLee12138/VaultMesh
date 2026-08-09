import { describe, expect, it } from 'vitest';

import {
  BROWSER_EXTENSION_WORKFLOWS,
  assertBrowserExtensionWorkflowManifest,
} from '../../src/shared/browser-extension-capabilities';

describe('browser extension workflow manifest', () => {
  it('assigns every public desktop RPC command to a real extension route', () => {
    expect(() => assertBrowserExtensionWorkflowManifest()).not.toThrow();
    expect(BROWSER_EXTENSION_WORKFLOWS.map((workflow) => workflow.id)).toEqual(expect.arrayContaining([
      'vault-session', 'login-management', 'card-management', 'identity-management',
      'ssh-management', 'secret-management', 'login-recovery', 'imports', 'vault-lifecycle', 'password-security',
    ]));
  });

  it('keeps destructive and disclosure workflows visibly confirmed', () => {
    const guarded = new Set(['login-recovery', 'card-recovery', 'identity-recovery', 'ssh-recovery', 'vault-lifecycle', 'browser-pairing', 'imports', 'ssh-key-scan', 'browser-autofill']);
    expect(BROWSER_EXTENSION_WORKFLOWS.filter((workflow) => guarded.has(workflow.id)).every((workflow) => workflow.requiresConfirmation)).toBe(true);
  });
});
