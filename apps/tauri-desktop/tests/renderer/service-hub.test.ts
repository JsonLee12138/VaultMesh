import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/pages/ServiceHubPage.tsx'), 'utf8');
const vaultSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/pages/VaultPage.tsx'), 'utf8');
const workbench = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ApiRequestWorkbench.tsx'), 'utf8');

describe('Service Hub renderer contract', () => {
  it('exposes aggregation, correction, navigation and non-cascading delete copy', () => {
    for (const marker of ['previewAggregation', 'applyAggregation', 'rollbackAggregation', '.merge(', '.split(', '.move(', '.unlink(', '原项目保持不变']) {
      expect(source).toContain(marker);
    }
    expect(source).not.toContain('copyPassword');
    expect(source).not.toContain('copySecretValue');
  });
  it('shows website/service cards in the vault and opens renderer-safe details in a dialog', () => {
    for (const marker of ['window.vaultMesh.services.list()', 'window.vaultMesh.services.detail(service.id)', '查看网站/服务：', '关联内容', '管理网站/服务']) {
      expect(vaultSource).toContain(marker);
    }
    expect(vaultSource).toContain('<DialogTitle>{selectedService?.name');
    expect(vaultSource).not.toContain('selectedServiceDetail.username');
    expect(vaultSource).not.toContain('selectedServiceDetail.password');
    expect(vaultSource).not.toContain('selectedServiceDetail.token');
  });
  it('exposes structured API environment editing without credential value access', () => {
    for (const marker of ['apiEnvironments.list', 'apiEnvironments.add', 'apiEnvironments.update', 'apiEnvironments.delete', 'OpenAPI URL', '固定 Headers', '执行时仍需独立授权']) {
      expect(source).toContain(marker);
    }
    expect(source).toContain('max-h-[85vh] overflow-x-hidden overflow-y-auto sm:max-w-2xl');
    expect(source).not.toContain('允许 Agent 使用');
    expect(source).not.toContain('agentEnabled');
    expect(source).not.toContain('setEnableCandidate');
    expect(source).not.toContain('credentialValue');
    expect(source).not.toContain('copyValue(');
  });
  it('uses only the typed privileged API request adapter and keeps responses memory-only', () => {
    for (const marker of ['apiRequests.prepare', 'apiRequests.execute', 'apiRequests.cancel', 'Canonical preview', 'execution-unknown', '请求与响应不会保存到历史']) {
      expect(workbench).toContain(marker);
    }
    for (const forbidden of ['fetch(', '@tauri-apps/plugin-http', 'localStorage', 'sessionStorage', 'credentialValue', 'Authorization:']) {
      expect(workbench).not.toContain(forbidden);
    }
  });
});
