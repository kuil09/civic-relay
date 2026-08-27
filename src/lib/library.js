import { promises as fs } from 'node:fs';
import path from 'node:path';
import { hashFile, sha256 } from './hash.js';
import {
  ensureDir,
  listFilesRecursive,
  pathExists,
  readJson,
  stableStringify,
  toPosix,
  writeJsonAtomic,
  writeTextAtomic,
} from './io.js';
import { scanText } from './privacy.js';

const PUBLIC_FILES = [
  'public-case.json',
  'summary.md',
  'policy-patterns.json',
  'redaction-manifest.json',
];
const TEXT_EXTENSIONS = new Set(['.md', '.json', '.csv', '.txt', '.yaml', '.yml', '.eml']);
const PROHIBITED_KEYS = new Set([
  'claims',
  'sources',
  'recipients',
  'dispatches',
  'responses',
  'approvals',
  'original_statement',
  'official_channel',
  'channel_source',
  'person_name',
  'provider_message_id',
  'dispatch_key',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function redactionCategory(relativePath) {
  const value = toPosix(String(relativePath || ''));
  if (value === 'case.json') return 'case-data';
  if (/^(?:0[0-7])-/.test(value)) return 'policy-document';
  if (value.startsWith('build/')) return 'generated-output';
  if (/^(?:08-|09-|10-)/.test(value)) return 'delivery-data';
  if (/^(?:11-|12-)/.test(value)) return 'response-data';
  return 'other';
}

function sanitizeRedactionManifest(manifest) {
  if (!isPlainObject(manifest)) throw new Error('redaction manifest must be an object');
  if (typeof manifest.created_at !== 'string' || Number.isNaN(new Date(manifest.created_at).getTime())) {
    throw new Error('redaction manifest requires a valid created_at');
  }
  if (!Array.isArray(manifest.files)) throw new Error('redaction manifest requires files');
  return {
    schema_version: '1.0',
    created_at: manifest.created_at,
    files: manifest.files
      .map((item) => {
        const originalPath = toPosix(String(item.path || ''));
        return {
          file_ref: sha256(originalPath).slice(0, 16),
          category: redactionCategory(originalPath),
          copied: Boolean(item.copied),
          redactions: isPlainObject(item.redactions) ? item.redactions : {},
        };
      })
      .sort((a, b) => a.file_ref.localeCompare(b.file_ref)),
  };
}

function assertSafeRelativePath(value, label) {
  if (!value || path.isAbsolute(value) || value === '..' || value.startsWith('../') || value.includes('/../')) {
    throw new Error(`${label} must be a safe relative path: ${value}`);
  }
}

function looksLikeLocalAbsolutePath(value) {
  if (typeof value !== 'string') return false;
  return value.startsWith('/Users/')
    || value.startsWith('/home/')
    || value.startsWith('/tmp/')
    || value.startsWith('/mnt/')
    || value.startsWith('/private/')
    || value.startsWith('/var/tmp/')
    || value.startsWith('file://')
    || /^[A-Za-z]:[\\/]/.test(value);
}

function inspectPublicValue(value, pointer, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectPublicValue(item, `${pointer}/${index}`, errors));
    return;
  }
  if (!isPlainObject(value)) {
    if (looksLikeLocalAbsolutePath(value)) errors.push(`${pointer || '/'}: local absolute path is not public`);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const next = `${pointer}/${key}`;
    if (PROHIBITED_KEYS.has(key)) errors.push(`${next}: prohibited case-specific field`);
    inspectPublicValue(nested, next, errors);
  }
}

async function scanDirectoryForSensitiveData(root, options = {}) {
  const { allowRedactionManifestPaths = false } = options;
  const findings = [];
  for (const file of await listFilesRecursive(root)) {
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    const text = await fs.readFile(file, 'utf8');
    for (const finding of scanText(text)) {
      findings.push({ path: toPosix(path.relative(root, file)), ...finding });
    }
    const relative = toPosix(path.relative(root, file));
    const allowExpectedPaths = allowRedactionManifestPaths && relative === 'redaction-manifest.json';
    if (!allowExpectedPaths && (/\/(?:Users|home|tmp|mnt|private|var\/tmp)\//.test(text) || /file:\/\//i.test(text) || /[A-Za-z]:\\Users\\/.test(text))) {
      findings.push({ path: relative, kind: 'privacy', label: 'local-path' });
    }
  }
  return findings;
}

async function sourceSnapshot(redactedCasePath) {
  const files = [];
  for (const file of await listFilesRecursive(redactedCasePath, { ignore: ['build/outbox', 'public'] })) {
    const relative = toPosix(path.relative(redactedCasePath, file));
    if (relative === 'redaction-manifest.json') continue;
    files.push({ path: relative, hash: await hashFile(file) });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, hash: sha256(stableStringify(files)) };
}

function uniqueSortedStrings(values) {
  return [...new Set(values.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))]
    .sort((a, b) => a.localeCompare(b));
}

function buildPolicyPatterns(data, publicationId) {
  const stakeholderPatterns = (data.stakeholders || []).map((item, index) => ({
    pattern_id: `stakeholder-pattern-${String(index + 1).padStart(3, '0')}`,
    roles: uniqueSortedStrings(item.roles || []),
    interests: uniqueSortedStrings(item.interests || []),
    risks: uniqueSortedStrings(item.risks || []),
  }));
  const policyOptions = (data.options || []).map((item, index) => ({
    pattern_id: `policy-option-pattern-${String(index + 1).padStart(3, '0')}`,
    title: item.title || `Policy option ${index + 1}`,
    category: item.category || 'unspecified',
    mechanism: item.mechanism || '',
    legal_change: item.legal_change || '',
    rights_impact: item.rights_impact || '',
    cost: item.cost || '',
    enforcement_difficulty: item.enforcement_difficulty || 'unknown',
    reversibility: item.reversibility || 'unknown',
    metrics: uniqueSortedStrings(item.metrics || []),
    stop_conditions: uniqueSortedStrings(item.stop_conditions || []),
    assumptions: uniqueSortedStrings(item.assumptions || []),
  }));
  const counterargumentPatterns = (data.counterarguments || []).map((item, index) => ({
    pattern_id: `counterargument-pattern-${String(index + 1).padStart(3, '0')}`,
    argument: item.argument || '',
    strength: item.strength || 'unrated',
    response_pattern: item.response || '',
    residual_risk: item.residual_risk || '',
  }));
  return {
    schema_version: '1.0',
    publication_id: publicationId,
    reusable_scope: 'design_patterns_only',
    prohibited_reuse: [
      'case-specific facts',
      'claims and sources',
      'recipient selections and contact channels',
      'dispatch and response history',
      'authorship, consent, and representativeness',
    ],
    problem_frame: {
      jurisdiction: data.jurisdiction || null,
      problem_definition: data.problem_definition || '',
      desired_change: data.desired_change || '',
      research_questions: uniqueSortedStrings(data.research_questions || []),
    },
    stakeholder_patterns: stakeholderPatterns,
    policy_option_patterns: policyOptions,
    counterargument_patterns: counterargumentPatterns,
  };
}

async function chooseSummary(redactedCasePath, data) {
  const candidates = ['build/one-page-summary.md', '07-policy-proposal.md', '01-issue-brief.md'];
  for (const candidate of candidates) {
    const file = path.join(redactedCasePath, candidate);
    if (await pathExists(file)) return fs.readFile(file, 'utf8');
  }
  return `# ${data.title || data.case_id}\n\n${data.problem_definition || '공개 요약 없음'}\n`;
}

async function writeIntegrityManifest(outputPath, snapshotAt) {
  const files = [];
  for (const relative of PUBLIC_FILES) {
    const file = path.join(outputPath, relative);
    files.push({ path: relative, sha256: await hashFile(file) });
  }
  const manifest = {
    schema_version: '1.0',
    snapshot_at: snapshotAt,
    algorithm: 'sha256',
    files,
  };
  await writeJsonAtomic(path.join(outputPath, 'integrity-manifest.json'), manifest);
  return manifest;
}

export async function publishCase(redactedCasePath, outputPath, options = {}) {
  const { force = false } = options;
  const sourceRoot = path.resolve(redactedCasePath);
  const destinationRoot = path.resolve(outputPath);
  if (destinationRoot === sourceRoot || destinationRoot.startsWith(`${sourceRoot}${path.sep}`)) {
    throw new Error('publish blocked: output must be outside the redacted case directory');
  }
  const manifestFile = path.join(redactedCasePath, 'redaction-manifest.json');
  if (!(await pathExists(manifestFile))) throw new Error('publish blocked: redaction-manifest.json is required');
  if (!(await pathExists(path.join(redactedCasePath, 'case.json')))) throw new Error('publish blocked: case.json is required');
  const sensitive = await scanDirectoryForSensitiveData(redactedCasePath, { allowRedactionManifestPaths: true });
  if (sensitive.length) {
    throw new Error(`publish blocked: redacted case still contains sensitive data: ${JSON.stringify(sensitive)}`);
  }
  if (await pathExists(outputPath)) {
    if (!force) throw new Error(`output already exists: ${outputPath}`);
    await fs.rm(outputPath, { recursive: true, force: true });
  }
  await ensureDir(outputPath);

  const rawManifest = await readJson(manifestFile);
  const redactionManifest = sanitizeRedactionManifest(rawManifest);
  const data = await readJson(path.join(redactedCasePath, 'case.json'));
  const snapshot = await sourceSnapshot(redactedCasePath);
  const redactionManifestHash = sha256(stableStringify(redactionManifest));
  const publicationId = `publication-${snapshot.hash.slice(0, 20)}`;
  const publicCaseId = `public-${snapshot.hash.slice(0, 20)}`;
  const policyPatterns = buildPolicyPatterns(data, publicationId);
  const publicCase = {
    schema_version: '1.0',
    publication_id: publicationId,
    case_id: publicCaseId,
    title: data.title || data.case_id || publicationId,
    jurisdiction: data.jurisdiction || null,
    dispatchable: false,
    published_snapshot_at: redactionManifest.created_at,
    source_snapshot_hash: snapshot.hash,
    redaction_manifest_hash: redactionManifestHash,
    assets: ['summary.md', 'policy-patterns.json'],
    restrictions: [
      'No recipient or contact data is reusable.',
      'Case-specific facts require independent verification.',
      'Publication does not transfer authorship, consent, or representation.',
    ],
  };
  const publicErrors = [];
  inspectPublicValue(publicCase, '', publicErrors);
  inspectPublicValue(policyPatterns, '', publicErrors);
  if (publicErrors.length) throw new Error(`publish blocked: ${publicErrors.join('; ')}`);

  await writeJsonAtomic(path.join(outputPath, 'public-case.json'), publicCase);
  await writeTextAtomic(path.join(outputPath, 'summary.md'), await chooseSummary(redactedCasePath, data));
  await writeJsonAtomic(path.join(outputPath, 'policy-patterns.json'), policyPatterns);
  await writeJsonAtomic(path.join(outputPath, 'redaction-manifest.json'), redactionManifest);
  const integrity = await writeIntegrityManifest(outputPath, redactionManifest.created_at);
  const validation = await validatePublicBundle(outputPath);
  if (!validation.valid) {
    await fs.rm(outputPath, { recursive: true, force: true });
    throw new Error(`published bundle failed validation: ${validation.errors.join('; ')}`);
  }
  return { public_case: publicCase, integrity };
}

export async function validatePublicBundle(bundlePath) {
  const errors = [];
  for (const relative of [...PUBLIC_FILES, 'integrity-manifest.json']) {
    if (!(await pathExists(path.join(bundlePath, relative)))) errors.push(`missing ${relative}`);
  }
  if (errors.length) return { valid: false, errors };

  let publicCase;
  let patterns;
  let integrity;
  try {
    publicCase = await readJson(path.join(bundlePath, 'public-case.json'));
    patterns = await readJson(path.join(bundlePath, 'policy-patterns.json'));
    integrity = await readJson(path.join(bundlePath, 'integrity-manifest.json'));
  } catch (error) {
    return { valid: false, errors: [error.message] };
  }
  if (publicCase.schema_version !== '1.0') errors.push('public-case.json: unsupported schema_version');
  if (publicCase.dispatchable !== false) errors.push('public-case.json: dispatchable must be false');
  if (typeof publicCase.publication_id !== 'string' || !publicCase.publication_id) errors.push('public-case.json: publication_id required');
  if (patterns.publication_id !== publicCase.publication_id) errors.push('policy-patterns.json: publication_id mismatch');
  if (patterns.reusable_scope !== 'design_patterns_only') errors.push('policy-patterns.json: reusable_scope must be design_patterns_only');

  inspectPublicValue(publicCase, '', errors);
  inspectPublicValue(patterns, '', errors);

  if (!Array.isArray(integrity.files)) errors.push('integrity-manifest.json: files required');
  else {
    const expected = new Set(PUBLIC_FILES);
    for (const item of integrity.files) {
      try { assertSafeRelativePath(item.path, 'integrity path'); }
      catch (error) { errors.push(error.message); continue; }
      expected.delete(item.path);
      const file = path.join(bundlePath, item.path);
      if (!(await pathExists(file))) errors.push(`integrity: missing ${item.path}`);
      else if (await hashFile(file) !== item.sha256) errors.push(`integrity: hash mismatch ${item.path}`);
    }
    for (const missing of expected) errors.push(`integrity: untracked ${missing}`);
  }
  const allowedFiles = new Set([...PUBLIC_FILES, 'integrity-manifest.json']);
  for (const file of await listFilesRecursive(bundlePath)) {
    const relative = toPosix(path.relative(bundlePath, file));
    if (!allowedFiles.has(relative)) errors.push(`unexpected public bundle file: ${relative}`);
  }
  const sensitive = await scanDirectoryForSensitiveData(bundlePath);
  for (const finding of sensitive) errors.push(`${finding.path}: public bundle contains ${finding.label}`);
  return { valid: errors.length === 0, errors, publication_id: publicCase.publication_id };
}

export async function buildLibrary(publicRoot, outputFile = path.join(publicRoot, 'library.json')) {
  const entries = [];
  const seen = new Set();
  if (!(await pathExists(publicRoot))) throw new Error(`public library root does not exist: ${publicRoot}`);
  const directories = (await fs.readdir(publicRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const directory of directories) {
    const bundlePath = path.join(publicRoot, directory.name);
    const validation = await validatePublicBundle(bundlePath);
    if (!validation.valid) throw new Error(`invalid public bundle ${directory.name}: ${validation.errors.join('; ')}`);
    const data = await readJson(path.join(bundlePath, 'public-case.json'));
    if (seen.has(data.publication_id)) throw new Error(`duplicate publication_id: ${data.publication_id}`);
    seen.add(data.publication_id);
    entries.push({
      publication_id: data.publication_id,
      case_id: data.case_id,
      title: data.title,
      jurisdiction: data.jurisdiction,
      dispatchable: false,
      published_snapshot_at: data.published_snapshot_at,
      bundle: directory.name,
      integrity_manifest: `${directory.name}/integrity-manifest.json`,
    });
  }
  entries.sort((a, b) => a.publication_id.localeCompare(b.publication_id));
  const library = { schema_version: '1.0', count: entries.length, entries };
  const publicErrors = [];
  inspectPublicValue(library, '', publicErrors);
  if (publicErrors.length) throw new Error(`library index is not public: ${publicErrors.join('; ')}`);
  await writeJsonAtomic(outputFile, library);
  return library;
}
