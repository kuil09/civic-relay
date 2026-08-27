import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { initCase } from '../src/lib/init.js';
import { validateCaseDirectory } from '../src/lib/validate.js';
import { repositoryRoot, tempDirectory } from './helpers.js';

test('init creates a valid intake case and preserves original statement', async () => {
  const root = await tempDirectory();
  const statement = '생활 현장에서 발견한 문제 원문';
  const casePath = await initCase({ slug: 'local-test-case', root, title: '테스트', statement });
  const result = await validateCaseDirectory(casePath);
  assert.equal(result.valid, true, JSON.stringify(result.findings));
  assert.equal(result.data.original_statement, statement);
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
