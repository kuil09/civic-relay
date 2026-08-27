import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { listFilesRecursive } from '../src/lib/io.js';
import { redactCase, scanLocalPaths } from '../src/lib/privacy.js';
import { recordResponse } from '../src/lib/responses.js';
import { loadCase } from '../src/lib/io.js';
import { copyExample, tempDirectory } from './helpers.js';

test('redact creates a separate public copy and removes contact data', async () => {
  const casePath = await copyExample();
  await fs.appendFile(path.join(casePath, '00-intake.md'), '\ncontact person@example.invalid 010-1234-5678\n');
  await fs.writeFile(path.join(casePath, 'attachment.bin'), Buffer.from([0, 1, 2, 3]));
  const output = path.join(await tempDirectory(), 'public');
  const manifest = await redactCase(casePath, output);
  const text = await fs.readFile(path.join(output, '00-intake.md'), 'utf8');
  const manifestText = await fs.readFile(path.join(output, 'redaction-manifest.json'), 'utf8');
  assert(!text.includes('person@example.invalid'));
  assert(!text.includes('010-1234-5678'));
  assert.equal(manifest.schema_version, '2.0');
  assert.match(manifest.source_snapshot_hash, /^[a-f0-9]{64}$/);
  assert.equal('source' in manifest, false);
  assert.equal('output' in manifest, false);
  assert.equal(manifestText.includes(casePath), false);
  assert.equal(manifestText.includes(output), false);
  assert.equal(/\/(?:Users|home|tmp|private|var\/tmp)\//.test(manifestText), false);
  assert.equal(/[A-Za-z]:[\\/]Users[\\/]/.test(manifestText), false);
  const intake = manifest.files.find((item) => item.path === '00-intake.md');
  assert.equal(intake.handling, 'processed_text');
  assert.equal(intake.copied, false);
  assert.equal(intake.redacted, true);
  assert.match(intake.source_hash, /^[a-f0-9]{64}$/);
  assert.match(intake.output_hash, /^[a-f0-9]{64}$/);
  const attachment = manifest.files.find((item) => item.path === 'attachment.bin');
  assert.equal(attachment.handling, 'copied_binary');
  assert.equal(attachment.copied, true);
  assert.equal(attachment.redacted, false);
  for (const file of await listFilesRecursive(output)) {
    const content = (await fs.readFile(file)).toString('utf8');
    assert.equal(content.includes(casePath), false, `${file} contains the source path`);
    assert.equal(content.includes(output), false, `${file} contains the output path`);
  }
});

test('local path scanning covers POSIX, macOS, Windows, and home shorthands', () => {
  const text = [
    '/Users/example/private.txt',
    '/home/example/private.txt',
    '/tmp/private.txt',
    'C:\\Users\\example\\private.txt',
    'D:/work/private.txt',
    '~/private.txt',
    '$HOME/private.txt',
    '${USERPROFILE}\\private.txt',
    '%USERPROFILE%\\private.txt',
    'file:///Users/example/private.txt',
  ].join('\n');
  const labels = new Set(scanLocalPaths(text).map((item) => item.label));
  assert.deepEqual(labels, new Set([
    'posix-local-path',
    'windows-local-path',
    'file-url',
    'tilde-home-path',
    'environment-home-path',
  ]));
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
