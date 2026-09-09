import fs from 'node:fs';
import path from 'node:path';
import { validateArchiveManifest } from './work-archive-lib.mjs';

const ROOT = process.cwd();
const DOC_DIRS = ['docs', 'specs', 'adr', 'changes', 'releases'];
const ALLOWED_STATUSES = new Set(['Draft', 'Accepted', 'Implementing', 'Verified', 'Released', 'Rejected']);
const ALLOWED_TYPES = new Set(['feature', 'bug', 'security', 'dependency', 'migration', 'technical_debt', 'governance']);
const OPTIONAL_ROUTING_KEYS = new Set(['context_refs', 'related_changes']);
const REMOVED_SOURCE_PREFIXES = [
  'apps/desktop',
  'apps/desktop-cli',
  'apps/macos',
  'apps/macos-cli',
  'apps/windows',
  'apps/native-host',
  'crates/electron-bridge',
];
const RETIRED_COMMANDS = new Set([
  'electron:dev',
  'electron:build',
  'electron:make',
  'electron:test',
  'electron:typecheck',
  'native:macos:contract-test',
  'native:macos:build',
  'native:macos:build:release',
  'native:macos:launch',
  'native:macos:browser-contract',
  'verify:native-browser-parity',
]);
const ARCHIVED_WORK_IDS = new Set(
  JSON.parse(fs.readFileSync('changes/archive.json', 'utf8')).archives.map((archive) => archive.work_id),
);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function setDifference(left, right) {
  return [...left].filter((value) => !right.has(value));
}

function parseChangeYaml(file) {
  const result = {};
  let activeList = null;
  for (const [index, raw] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const listItem = raw.match(/^  - (.+)$/);
    if (listItem) {
      if (!activeList || !Array.isArray(result[activeList])) throw new Error(`${file}:${index + 1}: orphan list item`);
      result[activeList].push(parseScalar(listItem[1], file, index + 1));
      continue;
    }
    const field = raw.match(/^([a-z][a-z0-9_]*):(?: (.*))?$/);
    if (!field) throw new Error(`${file}:${index + 1}: unsupported YAML syntax`);
    const [, key, encoded = ''] = field;
    if (key in result) throw new Error(`${file}:${index + 1}: duplicate key ${key}`);
    if (!encoded) {
      result[key] = [];
      activeList = key;
    } else {
      result[key] = parseScalar(encoded, file, index + 1);
      activeList = Array.isArray(result[key]) ? key : null;
    }
  }
  return result;
}

function parseScalar(encoded, file, line) {
  if (encoded === 'null') return null;
  if (encoded === '[]') return [];
  if (/^"(?:[^"\\]|\\.)*"$/.test(encoded)) return JSON.parse(encoded);
  throw new Error(`${file}:${line}: values must be quoted strings, null, or lists`);
}

function validateExplicitPaths(markdownFiles) {
  const missing = [];
  for (const file of markdownFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/`([^`\n]+)`/g)) {
      const token = match[1].replace(/[：，。；、,.;:]$/, '');
      if (/^(https?:|N\/A$)|[<>{}*]|v1-copy|^releases\/vX/.test(token)) continue;
      if (REMOVED_SOURCE_PREFIXES.some((prefix) => token === prefix || token.startsWith(`${prefix}/`))) continue;
      let candidate = null;
      if (token.startsWith('../') || token.startsWith('./')) candidate = path.resolve(path.dirname(file), token);
      else if (/^(docs|specs|adr|changes|releases|apps|crates|packages)\//.test(token)) candidate = path.resolve(ROOT, token);
      else if (file === 'docs/00-spec-index.md' && /^\d{2}-.*\.md$/.test(token)) candidate = path.resolve(ROOT, 'docs', token);
      else if ((file === 'releases/README.md' || file === 'changes/README.md') && token.startsWith('_template')) candidate = path.resolve(path.dirname(file), token);
      if (candidate && !fs.existsSync(candidate)) {
        const archivedWork = path.relative(ROOT, file).match(/^changes\/([^/]+)\//)?.[1];
        const retiredSource = /^(apps|crates|packages)\//.test(path.relative(ROOT, candidate));
        if (archivedWork && ARCHIVED_WORK_IDS.has(archivedWork) && retiredSource) continue;
        missing.push(`${file}: ${token}`);
      }
    }
  }
  return missing;
}

function validateContextRef(reference, file) {
  const separator = reference.indexOf('#');
  const referencedPath = separator === -1 ? reference : reference.slice(0, separator);
  const selector = separator === -1 ? null : reference.slice(separator + 1);
  const errors = [];

  if (!referencedPath || path.isAbsolute(referencedPath) || referencedPath.split('/').includes('..')) {
    return [`${file}: context_refs must use a repository-root relative path: ${reference}`];
  }
  if (/^changes\/(?!_template\/)/.test(referencedPath)) {
    return [`${file}: other Work Packages must use related_changes, not context_refs: ${reference}`];
  }

  const target = path.resolve(ROOT, referencedPath);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return [`${file}: context_refs path does not exist: ${reference}`];
  }
  if (selector === '') {
    errors.push(`${file}: context_refs selector is empty: ${reference}`);
  } else if (selector && !fs.readFileSync(target, 'utf8').includes(selector)) {
    errors.push(`${file}: context_refs selector not found: ${reference}`);
  }
  return errors;
}

const markdownFiles = ['AGENTS.md', ...DOC_DIRS.flatMap(walk).filter((file) => file.endsWith('.md'))];
const requirementText = fs.readFileSync('docs/03-functional-requirements.md', 'utf8');
const traceabilityText = fs.readFileSync('docs/08-traceability.md', 'utf8');
const requirements = new Set([...requirementText.matchAll(/^### ((?:REQ|NFR)-[A-Z]+-\d+)/gm)].map((match) => match[1]));
const tracedRequirements = new Set([...traceabilityText.matchAll(/^\| ((?:REQ|NFR)-[A-Z]+-\d+) \|/gm)].map((match) => match[1]));
const tests = new Set([...requirementText.matchAll(/`((?:AT|CT)-[A-Z-]+-\d+)`/g)].map((match) => match[1]));
const tracedTests = new Set([...traceabilityText.matchAll(/(?:AT|CT)-[A-Z-]+-\d+/g)].map((match) => match[0]));

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const documentedCommands = new Set();
for (const file of markdownFiles) {
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/pnpm ([a-z][a-z0-9:.-]+)/g)) documentedCommands.add(match[1]);
}
const absentCommands = [...documentedCommands].filter((command) => command !== 'install'
  && !RETIRED_COMMANDS.has(command)
  && !(command in packageJson.scripts));

const adrIds = new Set(walk('adr')
  .filter((file) => /^\d{4}-.*\.md$/.test(path.basename(file)))
  .map((file) => `ADR-${path.basename(file).slice(0, 4)}`));

const yamlFiles = walk('changes').filter((file) => file.endsWith('.yaml')).sort();
const parsedChanges = yamlFiles.map((file) => [file, parseChangeYaml(file)]);
const templateChange = parsedChanges.find(([file]) => file === 'changes/_template/change.yaml')[1];
const templateKeys = Object.keys(templateChange).sort();
const requiredTemplateKeys = templateKeys.filter((key) => !OPTIONAL_ROUTING_KEYS.has(key));
const changeIds = new Map();
const yamlErrors = [];

for (const [file, change] of parsedChanges) {
  if (file === 'changes/_template/change.yaml') continue;
  if (changeIds.has(change.id)) yamlErrors.push(`${file}: duplicate Change ID ${change.id}`);
  else changeIds.set(change.id, file);
}

for (const [file, change] of parsedChanges) {
  const keys = Object.keys(change).sort();
  const missingKeys = requiredTemplateKeys.filter((key) => !keys.includes(key));
  const unknownKeys = keys.filter((key) => !templateKeys.includes(key));
  if (missingKeys.length > 0) yamlErrors.push(`${file}: missing required fields ${missingKeys.join(', ')}`);
  if (unknownKeys.length > 0) yamlErrors.push(`${file}: unknown fields ${unknownKeys.join(', ')}`);
  if (!ALLOWED_STATUSES.has(change.status)) yamlErrors.push(`${file}: invalid status ${change.status}`);
  if (!ALLOWED_TYPES.has(change.type)) yamlErrors.push(`${file}: invalid type ${change.type}`);
  for (const adr of change.adrs) if (!/^ADR-\d{4}$/.test(adr) || (!file.includes('_template') && !adrIds.has(adr))) yamlErrors.push(`${file}: unknown ADR ${adr}`);

  const hasContextRefs = Object.hasOwn(change, 'context_refs');
  const hasRelatedChanges = Object.hasOwn(change, 'related_changes');
  if (hasContextRefs !== hasRelatedChanges) {
    yamlErrors.push(`${file}: context_refs and related_changes must be declared together`);
    continue;
  }
  if (file !== 'changes/_template/change.yaml' && change.spec_revision !== '0.1.0-active' && !hasContextRefs) {
    yamlErrors.push(`${file}: routing fields are required after spec revision 0.1.0-active`);
    continue;
  }
  if (!hasContextRefs) continue;
  if (!Array.isArray(change.context_refs) || !Array.isArray(change.related_changes)) {
    yamlErrors.push(`${file}: context_refs and related_changes must be lists`);
    continue;
  }
  for (const reference of change.context_refs) yamlErrors.push(...validateContextRef(reference, file));
  if (file === 'changes/_template/change.yaml') continue;
  for (const relatedId of change.related_changes) {
    if (relatedId === change.id) yamlErrors.push(`${file}: related_changes cannot reference itself`);
    else if (!changeIds.has(relatedId)) yamlErrors.push(`${file}: unknown related Change ${relatedId}`);
  }
}

const duplicateStateViews = [];
const specIndexText = fs.readFileSync('docs/00-spec-index.md', 'utf8');
if (/^当前变更：$/m.test(specIndexText)) duplicateStateViews.push('docs/00-spec-index.md: duplicated current Change status list');
if (/^## 活动 Change$/m.test(traceabilityText)) duplicateStateViews.push('docs/08-traceability.md: duplicated active Change status table');

const proportionalityErrors = [];
const proportionalityMarkers = [
  ['AGENTS.md', '## 1.2 Work 与文档比例'],
  ['AGENTS.md', 'Work 的判断依据是是否需要长期保存'],
  ['AGENTS.md', '直接修改可以新增或更新局部回归测试'],
  ['docs/09-document-governance.md', '## 2. Work 比例与建立条件'],
  ['docs/09-document-governance.md', '修改可以不建 Work，当且仅当'],
  ['changes/_template/change.md', '> 文档比例：'],
];
for (const [file, marker] of proportionalityMarkers) {
  if (!fs.readFileSync(file, 'utf8').includes(marker)) proportionalityErrors.push(`${file}: missing proportionality marker ${marker}`);
}
for (const file of ['AGENTS.md', 'docs/09-document-governance.md']) {
  if (fs.readFileSync(file, 'utf8').includes('不需要新增测试或修改')) proportionalityErrors.push(`${file}: test changes must not automatically require Work`);
}

const errors = {
  missing_paths: validateExplicitPaths(markdownFiles),
  requirements_not_traced: setDifference(requirements, tracedRequirements),
  trace_without_requirement: setDifference(tracedRequirements, requirements),
  tests_not_traced: setDifference(tests, tracedTests),
  trace_tests_without_requirement: setDifference(tracedTests, tests),
  absent_commands: absentCommands,
  yaml_errors: yamlErrors,
  duplicate_change_state_views: duplicateStateViews,
  documentation_proportionality: proportionalityErrors,
  work_archives: validateArchiveManifest({
    root: ROOT,
    changes: parsedChanges
      .filter(([file]) => file !== 'changes/_template/change.yaml')
      .map(([file, change]) => ({ file, id: change.id, status: change.status })),
    baseRef: process.env.VAULTMESH_ARCHIVE_BASE_REF || 'HEAD',
  }),
};

if (Object.values(errors).some((values) => values.length > 0)) {
  console.error(JSON.stringify(errors, null, 2));
  process.exit(1);
}

const routedChanges = parsedChanges.filter(([, change]) => Object.hasOwn(change, 'context_refs')).length - 1;
const archivedChanges = ARCHIVED_WORK_IDS.size;
console.log(`docs:check passed (${markdownFiles.length} Markdown, ${yamlFiles.length} YAML, ${requirements.size} requirements, ${tests.size} test IDs, ${adrIds.size} ADRs, ${routedChanges} routed Changes, ${archivedChanges} archived Changes)`);
