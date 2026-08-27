import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { publishCase, validatePublicBundle } from '../src/lib/library.js';
import { redactCase, scanText } from '../src/lib/privacy.js';
import { repositoryRoot } from './helpers.js';

const execFileAsync = promisify(execFile);
const cli = path.join(repositoryRoot, 'src', 'cli.js');

function runCli(...args) {
  return execFileAsync(process.execPath, [cli, ...args], { cwd: repositoryRoot });
}

async function tempRoot(t) {
  const root = await fs.mkdtemp('/tmp/civic-relay-library-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function createRedactedCase(root, id = 'night-delivery') {
  const sourcePath = path.join(root, `${id}-source`);
  const casePath = path.join(root, `${id}-redacted`);
  await fs.cp(path.join(repositoryRoot, 'examples', 'apartment-night-delivery'), sourcePath, { recursive: true });
  const data = JSON.parse(await fs.readFile(path.join(sourcePath, 'case.json'), 'utf8'));
  data.case_id = id;
  await fs.writeFile(path.join(sourcePath, 'case.json'), `${JSON.stringify(data, null, 2)}\n`);
  await redactCase(sourcePath, casePath);
  return casePath;
}

async function readCoreBundle(bundle) {
  const output = {};
  for (const file of ['public-case.json', 'summary.md', 'policy-patterns.json', 'redaction-manifest.json', 'integrity-manifest.json']) {
    output[file] = await fs.readFile(path.join(bundle, file), 'utf8');
  }
  return output;
}

async function snapshotDirectory(root) {
  const snapshot = {};
  async function visit(current) {
    for (const entry of (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) snapshot[path.relative(root, absolute)] = (await fs.readFile(absolute)).toString('base64');
    }
  }
  await visit(root);
  return snapshot;
}

test('a fresh intake remains structurally valid and buildable but CLI publication fails readiness', async (t) => {
  const root = await tempRoot(t);
  const casesRoot = path.join(root, 'cases');
  await runCli('init', 'empty-case', '--root', casesRoot, '--statement', 'A civic concern.');
  const casePath = path.join(casesRoot, 'empty-case');
  const validation = JSON.parse((await runCli('validate', casePath, '--json')).stdout);
  assert.equal(validation.valid, true, JSON.stringify(validation.findings));
  assert.match((await runCli('validate', casePath)).stdout, /STRUCTURALLY VALID/);

  await runCli('build', casePath);
  const redacted = path.join(root, 'empty-redacted');
  await runCli('redact', casePath, '--output', redacted);
  let readinessFailure;
  try {
    await runCli('readiness', redacted, '--stage', 'publication');
  } catch (error) {
    readinessFailure = error;
  }
  assert.ok(readinessFailure, 'publication readiness should fail for a fresh intake');
  const readiness = JSON.parse(readinessFailure.stdout);
  assert.equal(readiness.structural_valid, true);
  assert.equal(readiness.ready, false);
  const codes = new Set(readiness.findings.map((item) => item.code));
  for (const code of [
    'missing_claims',
    'missing_sources',
    'missing_status_quo',
    'insufficient_alternatives',
    'insufficient_strong_counterarguments',
  ]) assert.equal(codes.has(code), true, `missing readiness finding ${code}`);

  const bundle = path.join(root, 'public', 'empty-case');
  await assert.rejects(
    () => runCli('publish-case', redacted, '--output', bundle),
    (error) => {
      assert.match(error.stderr, /publication readiness failed/);
      assert.match(error.stderr, /case\.json#\/claims \[missing_claims\]/);
      assert.match(error.stderr, /case\.json#\/sources \[missing_sources\]/);
      return true;
    },
  );
  await assert.rejects(() => fs.stat(bundle), { code: 'ENOENT' });
});

test('the complete example validates, builds, redacts, and publishes through the production CLI', async (t) => {
  const root = await tempRoot(t);
  const casePath = path.join(root, 'complete-case');
  await fs.cp(path.join(repositoryRoot, 'examples', 'apartment-night-delivery'), casePath, { recursive: true });
  const validation = JSON.parse((await runCli('validate', casePath, '--json')).stdout);
  assert.equal(validation.valid, true, JSON.stringify(validation.findings));
  await runCli('build', casePath);
  const redacted = path.join(root, 'complete-redacted');
  await runCli('redact', casePath, '--output', redacted);
  const readiness = JSON.parse((await runCli('readiness', redacted, '--stage', 'publication')).stdout);
  assert.equal(readiness.ready, true, JSON.stringify(readiness.findings));
  const bundle = path.join(root, 'public', 'complete');
  const published = JSON.parse((await runCli('publish-case', redacted, '--output', bundle)).stdout);
  assert.equal(published.public_case.dispatchable, false);
  assert.equal((await validatePublicBundle(bundle)).valid, true);
});

test('publishing requires a redacted case and strips case-specific records', async (t) => {
  const root = await tempRoot(t);
  const original = path.join(root, 'original');
  await fs.mkdir(original);
  await fs.writeFile(path.join(original, 'case.json'), '{}\n');
  await assert.rejects(() => publishCase(original, path.join(root, 'blocked')), /redaction-manifest/);

  const redacted = await createRedactedCase(root);
  const bundle = path.join(root, 'public', 'night-delivery');
  const result = await publishCase(redacted, bundle);
  assert.equal(result.public_case.dispatchable, false);
  const validation = await validatePublicBundle(bundle);
  assert.equal(validation.valid, true, validation.errors.join('\n'));

  const publicCase = JSON.parse(await fs.readFile(path.join(bundle, 'public-case.json'), 'utf8'));
  const patterns = JSON.parse(await fs.readFile(path.join(bundle, 'policy-patterns.json'), 'utf8'));
  const sanitizedManifest = JSON.parse(await fs.readFile(path.join(bundle, 'redaction-manifest.json'), 'utf8'));
  assert.equal(sanitizedManifest.schema_version, '2.0');
  assert.match(sanitizedManifest.source_snapshot_hash, /^[a-f0-9]{64}$/);
  assert.equal('source' in sanitizedManifest, false);
  assert.equal('output' in sanitizedManifest, false);
  assert.ok(sanitizedManifest.files.every((item) => !('path' in item)));
  assert.ok(sanitizedManifest.files.every((item) => ['copied_binary', 'processed_text'].includes(item.handling)));
  for (const prohibited of ['claims', 'sources', 'recipients', 'dispatches', 'responses', 'approvals', 'original_statement']) {
    assert.equal(prohibited in publicCase, false);
    assert.equal(prohibited in patterns, false);
  }
  assert.equal(JSON.stringify(patterns).includes('특정 기관명'), false);
  assert.equal(patterns.reusable_scope, 'design_patterns_only');
});

test('publication accepts a legacy redaction manifest and removes its local paths', async (t) => {
  const root = await tempRoot(t);
  const redacted = await createRedactedCase(root);
  const manifestPath = path.join(redacted, 'redaction-manifest.json');
  const versioned = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const legacy = {
    source: '/tmp/private/night-delivery',
    output: redacted,
    created_at: versioned.created_at,
    files: versioned.files.map((item) => ({
      path: item.path,
      copied: item.copied,
      redactions: item.redactions,
    })),
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(legacy, null, 2)}\n`);
  const bundle = path.join(root, 'public', 'legacy');
  await publishCase(redacted, bundle);
  const sanitized = JSON.parse(await fs.readFile(path.join(bundle, 'redaction-manifest.json'), 'utf8'));
  assert.equal(sanitized.schema_version, '1.0');
  assert.equal('source' in sanitized, false);
  assert.equal('output' in sanitized, false);
  assert.ok(sanitized.files.every((item) => !('path' in item)));
});

test('public bundles contain no sensitive data or local absolute paths', async (t) => {
  const root = await tempRoot(t);
  const redacted = await createRedactedCase(root);
  const bundle = path.join(root, 'public', 'bundle');
  await publishCase(redacted, bundle);
  for (const entry of await fs.readdir(bundle)) {
    const text = await fs.readFile(path.join(bundle, entry), 'utf8');
    assert.deepEqual(scanText(text), []);
    assert.equal(text.includes('/tmp/private/'), false);
    assert.equal(text.includes(root), false);
  }
});

test('publication is deterministic for the same redacted snapshot', async (t) => {
  const root = await tempRoot(t);
  const redacted = await createRedactedCase(root);
  const first = path.join(root, 'public-a', 'bundle');
  const second = path.join(root, 'public-b', 'bundle');
  await publishCase(redacted, first);
  await publishCase(redacted, second);
  assert.deepEqual(await readCoreBundle(first), await readCoreBundle(second));
});

test('library index contains only valid bundles and remains deterministic', async (t) => {
  const root = await tempRoot(t);
  const publicRoot = path.join(root, 'public');
  await publishCase(await createRedactedCase(root, 'case-b'), path.join(publicRoot, 'b'));
  await publishCase(await createRedactedCase(root, 'case-a'), path.join(publicRoot, 'a'));
  const first = JSON.parse((await runCli('build-library', publicRoot)).stdout);
  const firstText = await fs.readFile(path.join(publicRoot, 'library.json'), 'utf8');
  const second = JSON.parse((await runCli('build-library', publicRoot)).stdout);
  const secondText = await fs.readFile(path.join(publicRoot, 'library.json'), 'utf8');
  assert.deepEqual(first, second);
  assert.equal(firstText, secondText);
  assert.equal(first.count, 2);
  assert.deepEqual(first.entries.map((entry) => entry.bundle), ['a', 'b']);
  assert.ok(first.entries.every((entry) => entry.dispatchable === false));
  assert.equal(firstText.includes(root), false);
});

test('build-library rejects a bundle root through the production CLI without changing bundle bytes', async (t) => {
  const root = await tempRoot(t);
  const bundle = path.join(root, 'public', 'example');
  await publishCase(await createRedactedCase(root), bundle);
  const before = await snapshotDirectory(bundle);
  const output = path.join(bundle, 'library');
  await assert.rejects(
    () => runCli('build-library', bundle, '--output', output),
    (error) => {
      assert.match(error.stderr, /parent directory of public bundles, not a bundle/);
      return true;
    },
  );
  assert.deepEqual(await snapshotDirectory(bundle), before);
  await assert.rejects(() => fs.stat(output), { code: 'ENOENT' });
});

test('build-library rejects output nested in a discovered bundle before writing', async (t) => {
  const root = await tempRoot(t);
  const publicRoot = path.join(root, 'public');
  const bundle = path.join(publicRoot, 'example');
  await publishCase(await createRedactedCase(root), bundle);
  const before = await snapshotDirectory(bundle);
  const output = path.join(bundle, 'nested', 'library.json');
  await assert.rejects(
    () => runCli('build-library', publicRoot, '--output', output),
    (error) => {
      assert.match(error.stderr, /output must not be inside a public bundle/);
      return true;
    },
  );
  assert.deepEqual(await snapshotDirectory(bundle), before);
  await assert.rejects(() => fs.stat(output), { code: 'ENOENT' });
});
