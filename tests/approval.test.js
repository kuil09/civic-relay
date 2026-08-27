import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { approveCase, approvalState } from '../src/lib/approval.js';
import { buildCase } from '../src/lib/build.js';
import { copyExample } from './helpers.js';

test('approval follows dependency order and becomes stale after content changes', async () => {
  const casePath = await copyExample();
  await approveCase(casePath, { stage: 'problem', actor: 'Human Reviewer', confirmHuman: true });
  await approveCase(casePath, { stage: 'evidence', actor: 'Human Reviewer', confirmHuman: true });
  await approveCase(casePath, { stage: 'policy', actor: 'Human Reviewer', confirmHuman: true });
  await approveCase(casePath, { stage: 'recipients', actor: 'Human Reviewer', confirmHuman: true });
  await buildCase(casePath);
  await approveCase(casePath, { stage: 'document', actor: 'Human Reviewer', confirmHuman: true });
  assert.equal((await approvalState(casePath, 'document')).valid, true);
  await fs.appendFile(path.join(casePath, '07-policy-proposal.md'), '\n수정됨\n');
  const changed = await approvalState(casePath, 'document');
  assert.equal(changed.valid, false);
  assert.equal(changed.reason, 'content_changed');
});

test('AI-labelled actor cannot approve', async () => {
  const casePath = await copyExample();
  await assert.rejects(
    approveCase(casePath, { stage: 'problem', actor: 'AI Agent', confirmHuman: true }),
    /cannot be approval actors/,
  );
});
