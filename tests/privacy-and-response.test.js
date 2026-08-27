import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { redactCase } from '../src/lib/privacy.js';
import { recordResponse } from '../src/lib/responses.js';
import { loadCase } from '../src/lib/io.js';
import { copyExample, tempDirectory } from './helpers.js';

test('redact creates a separate public copy and removes contact data', async () => {
  const casePath = await copyExample();
  await fs.appendFile(path.join(casePath, '00-intake.md'), '\ncontact person@example.invalid 010-1234-5678\n');
  const output = path.join(await tempDirectory(), 'public');
  const manifest = await redactCase(casePath, output);
  const text = await fs.readFile(path.join(output, '00-intake.md'), 'utf8');
  assert(!text.includes('person@example.invalid'));
  assert(!text.includes('010-1234-5678'));
  assert(manifest.files.some((item) => item.path === '00-intake.md'));
});

test('response tracking preserves raw response and sets follow_up state', async () => {
  const casePath = await copyExample();
  const dir = await tempDirectory();
  const source = path.join(dir, 'response.txt');
  await fs.writeFile(source, '소관 부서로 이관했습니다.', 'utf8');
  const result = await recordResponse(casePath, {
    recipientId: 'recipient-na-health-role',
    classification: 'referred',
    sourceFile: source,
    summary: '다른 부서로 이관됨',
    followUpTasks: ['이관 부서 확인'],
  });
  assert.equal(result.classification, 'referred');
  const data = await loadCase(casePath);
  assert.equal(data.status, 'follow_up');
  assert.equal(data.responses.length, 1);
  assert(await fs.stat(path.join(casePath, result.original_file)));
});
