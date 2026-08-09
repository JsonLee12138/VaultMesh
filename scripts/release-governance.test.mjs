import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseGovernanceFiles = ['releases/README.md', 'releases/_template.md'];

test('release governance files exist in a clean Git checkout', async () => {
  for (const relativePath of releaseGovernanceFiles) {
    const trackedPath = execFileSync(
      'git',
      ['ls-files', '--error-unmatch', relativePath],
      { cwd: root, encoding: 'utf8' },
    ).trim();
    assert.equal(trackedPath, relativePath, `${relativePath} must be tracked`);
    assert.ok((await readFile(path.join(root, relativePath), 'utf8')).length > 0);
  }
});

test('release template preserves archive and release-gate ownership', async () => {
  const template = await readFile(path.join(root, 'releases/_template.md'), 'utf8');
  assert.match(template, /changes\/archive\.json/);
  assert.match(template, /GATE-1\.\.6/);
  assert.match(template, /Git Tag/);
});
