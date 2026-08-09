import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseRecoveryCodes } from '../../src/renderer/src/lib/recovery-codes';

describe('CT-RECOVERY-CODES-001 renderer behavior', () => {
  it('parses newline-delimited codes while preserving non-empty code content', () => {
    expect(parseRecoveryCodes('alpha\r\n\n beta code \n\t\ncharlie')).toEqual([
      'alpha',
      ' beta code ',
      'charlie',
    ]);
  });

  it('offers bounded file import through the typed desktop API', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/pages/ItemEditorPage.tsx'), 'utf8');
    expect(source).toContain('window.vaultMesh.items.importRecoveryCodesFile()');
    expect(source).toContain('选择恢复码文件');
    expect(source).toContain("result.sourceFileStatus === 'deleted'");
  });
});
