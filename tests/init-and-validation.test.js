import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { initCase } from '../src/lib/init.js';
import { validateCaseDirectory } from '../src/lib/validate.js';
import { repositoryRoot, tempDirectory } from './helpers.js';

const execFileAsync = promisify(execFile);

test('init creates a valid intake case and preserves original statement', async () => {
  const root = await tempDirectory();
  const statement = '생활 현장에서 발견한 문제 원문';
  const casePath = await initCase({ slug: 'local-test-case', root, title: '테스트', statement });
  const result = await validateCaseDirectory(casePath);
  assert.equal(result.valid, true, JSON.stringify(result.findings));
  assert.equal(result.data.original_statement, statement);
  assert.equal(result.data.jurisdiction.adapter_id, 'KR');
});

test('init selects explicit jurisdiction adapters and reports the documented default', async () => {
  const root = await tempDirectory();
  const cli = path.join(repositoryRoot, 'src', 'cli.js');
  const krCase = await initCase({ slug: 'kr-case', root, jurisdiction: 'KR' });
  const krData = JSON.parse(await fs.readFile(path.join(krCase, 'case.json'), 'utf8'));
  assert.equal(krData.jurisdiction.adapter_id, 'KR');
  assert.equal(krData.jurisdiction.country, 'KR');

  const explicit = await execFileAsync(process.execPath, [
    cli,
    'init',
    'us-federal-case',
    '--root', root,
    '--jurisdiction', 'US-FED',
  ]);
  const explicitData = JSON.parse(await fs.readFile(path.join(root, 'us-federal-case', 'case.json'), 'utf8'));
  assert.equal(explicitData.jurisdiction.adapter_id, 'US-FED');
  assert.equal(explicitData.jurisdiction.country, 'US');
  assert.match(explicit.stdout, /Jurisdiction adapter: US-FED \(explicit\)/);

  const omitted = await execFileAsync(process.execPath, [cli, 'init', 'default-case', '--root', root]);
  const defaultData = JSON.parse(await fs.readFile(path.join(root, 'default-case', 'case.json'), 'utf8'));
  assert.equal(defaultData.jurisdiction.adapter_id, 'KR');
  assert.match(omitted.stdout, /Jurisdiction adapter: KR \(documented default\)/);
});

test('init rejects unknown jurisdiction adapters before creating a partial case', async () => {
  const root = await tempDirectory();
  const cli = path.join(repositoryRoot, 'src', 'cli.js');
  await assert.rejects(
    execFileAsync(process.execPath, [
      cli,
      'init',
      'unknown-jurisdiction',
      '--root', root,
      '--jurisdiction', 'UNKNOWN',
    ]),
    (error) => error.stderr.includes('unknown jurisdiction adapter: UNKNOWN'),
  );
  await assert.rejects(() => fs.stat(path.join(root, 'unknown-jurisdiction')), { code: 'ENOENT' });
});

test('the public apartment example satisfies structural validation', async () => {
  const result = await validateCaseDirectory(path.join(repositoryRoot, 'examples', 'apartment-night-delivery'));
  assert.equal(result.valid, true, JSON.stringify(result.findings));
});

test('draft status rejects missing alternatives and counterarguments', async () => {
  const root = await tempDirectory();
  const casePath = await initCase({ slug: 'invalid-draft', root, title: 'Invalid', statement: '원문' });
  const file = path.join(casePath, 'case.json');
  const data = JSON.parse(await (await import('node:fs/promises')).readFile(file, 'utf8'));
  data.status = 'draft';
  await (await import('node:fs/promises')).writeFile(file, JSON.stringify(data, null, 2));
  const result = await validateCaseDirectory(casePath);
  assert.equal(result.valid, false);
  assert(result.findings.some((item) => item.code === 'insufficient_options'));
  assert(result.findings.some((item) => item.code === 'insufficient_counterarguments'));
});
