import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { approveCase } from '../src/lib/approval.js';
import { buildCase } from '../src/lib/build.js';
import { dispatchCase, prepareDrafts } from '../src/lib/mail.js';
import { loadCase, saveCase } from '../src/lib/io.js';
import { copyExample, tempDirectory, writeRecipientCsv } from './helpers.js';

async function prepareApprovedCase() {
  const casePath = await copyExample();
  const data = await loadCase(casePath);
  const selected = data.recipients.slice(0, 2);
  selected[0].official_channel = 'mailto:first@example.invalid';
  selected[1].official_channel = 'mailto:second@example.invalid';
  for (const recipient of selected) {
    recipient.channel_type = 'email';
    recipient.channel_source = 'https://official.example.invalid/contact';
    recipient.verified_at = new Date().toISOString();
    recipient.verification_status = 'valid';
    recipient.selected = true;
    recipient.status = 'draft';
  }
  data.recipients = selected;
  await saveCase(casePath, data);
  await writeRecipientCsv(casePath, selected);
  for (const stage of ['problem', 'evidence', 'policy', 'recipients']) {
    await approveCase(casePath, { stage, actor: 'Human Reviewer', confirmHuman: true });
  }
  await buildCase(casePath);
  await approveCase(casePath, { stage: 'document', actor: 'Human Reviewer', confirmHuman: true });
  return casePath;
}

test('file drafts isolate recipient addresses', async () => {
  const casePath = await prepareApprovedCase();
  const records = await prepareDrafts(casePath, { requireCurrentRecipients: true });
  assert.equal(records.length, 2);
  const first = await fs.readFile(path.join(casePath, records[0].output_file), 'utf8');
  const second = await fs.readFile(path.join(casePath, records[1].output_file), 'utf8');
  assert(first.includes('first@example.invalid'));
  assert(!first.includes('second@example.invalid'));
  assert(second.includes('second@example.invalid'));
  assert(!second.includes('first@example.invalid'));
});

test('send requires approval, invokes explicit adapter, and blocks duplicates', async () => {
  const casePath = await prepareApprovedCase();
  await prepareDrafts(casePath, { requireCurrentRecipients: true });
  await approveCase(casePath, { stage: 'dispatch', actor: 'Human Reviewer', confirmHuman: true });

  const toolRoot = await tempDirectory('civic-adapter-');
  const adapter = path.join(toolRoot, 'adapter.mjs');
  await fs.writeFile(adapter, `#!/usr/bin/env node\nlet raw='';process.stdin.on('data',c=>raw+=c);process.stdin.on('end',()=>{JSON.parse(raw);process.stdout.write(JSON.stringify({status:'sent',message_id:'fake-id'}));});\n`, 'utf8');
  await fs.chmod(adapter, 0o755);
  process.env.CIVIC_RELAY_MAIL_ADAPTER = adapter;
  const results = await dispatchCase(casePath, { mode: 'send', maxAgeHours: 24 });
  assert.equal(results.length, 2);
  assert(results.every((item) => item.status === 'sent'));
  await assert.rejects(dispatchCase(casePath, { mode: 'send', maxAgeHours: 24 }), /duplicate send blocked/);
  delete process.env.CIVIC_RELAY_MAIL_ADAPTER;
});
