import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { approveCase, approvalState } from '../src/lib/approval.js';
import { computeDocumentHash, hashFile } from '../src/lib/hash.js';
import { initCase } from '../src/lib/init.js';
import { copyExample, repositoryRoot, tempDirectory } from './helpers.js';

const execFileAsync = promisify(execFile);
const cli = path.join(repositoryRoot, 'src', 'cli.js');

async function runBuild(casePath) {
  const { stdout } = await execFileAsync(process.execPath, [cli, 'build', casePath]);
  return JSON.parse(stdout);
}

async function readCase(casePath) {
  return JSON.parse(await fs.readFile(path.join(casePath, 'case.json'), 'utf8'));
}

test('the CLI keeps one current artifact record per build output across unchanged builds', async () => {
  const casePath = await copyExample();
  await runBuild(casePath);
  await runBuild(casePath);

  const data = await readCase(casePath);
  const buildArtifacts = data.artifacts.filter((artifact) => artifact.kind === 'build');
  assert.deepEqual(buildArtifacts.map((artifact) => artifact.path), [
    '07-policy-proposal.md',
    'build/distribution-notice.md',
    'build/evidence-appendix.md',
    'build/one-page-summary.md',
    'build/package-manifest.json',
    'build/review.md',
  ]);
  assert.equal(new Set(buildArtifacts.map((artifact) => `${artifact.kind}\0${artifact.path}`)).size, buildArtifacts.length);

  for (const artifact of buildArtifacts) {
    assert.equal(artifact.hash, await hashFile(path.join(casePath, artifact.path)));
  }
});

test('the CLI replaces a changed artifact record instead of retaining build history', async () => {
  const casePath = await copyExample();
  const firstManifest = await runBuild(casePath);
  const before = await readCase(casePath);
  const firstProposal = before.artifacts.find((artifact) => (
    artifact.kind === 'build' && artifact.path === '07-policy-proposal.md'
  ));

  await fs.appendFile(path.join(casePath, '07-policy-proposal.md'), '\nA changed proposal revision.\n');
  const secondManifest = await runBuild(casePath);
  const after = await readCase(casePath);
  const proposalRecords = after.artifacts.filter((artifact) => (
    artifact.kind === 'build' && artifact.path === '07-policy-proposal.md'
  ));

  assert.equal(proposalRecords.length, 1);
  assert.notEqual(proposalRecords[0].hash, firstProposal.hash);
  assert.notEqual(secondManifest.document_hash, firstManifest.document_hash);
  assert.equal(proposalRecords[0].hash, await hashFile(path.join(casePath, '07-policy-proposal.md')));
});

test('unchanged CLI rebuilds preserve the document hash and current document approval', async () => {
  const casePath = await copyExample();
  for (const stage of ['problem', 'evidence', 'policy', 'recipients']) {
    await approveCase(casePath, { stage, actor: 'Human Reviewer', confirmHuman: true });
  }
  await runBuild(casePath);
  const approvedHash = await computeDocumentHash(casePath);
  await approveCase(casePath, { stage: 'document', actor: 'Human Reviewer', confirmHuman: true });
  assert.equal((await approvalState(casePath, 'document')).valid, true);

  await runBuild(casePath);
  await runBuild(casePath);

  assert.equal(await computeDocumentHash(casePath), approvedHash);
  assert.equal((await approvalState(casePath, 'document')).valid, true);
});

test('preview build reports structural validation separately from semantic readiness', async () => {
  const root = await tempDirectory();
  const casePath = await initCase({
    slug: 'readiness-preview',
    root,
    statement: 'A civic concern that still needs research.',
  });
  const manifest = await runBuild(casePath);
  assert.equal(manifest.validation.contract, 'structural_validation');
  assert.equal(manifest.validation.valid, true);
  assert.equal(manifest.readiness.contract, 'semantic_readiness');
  assert.equal(manifest.readiness.stage, 'case');
  assert.equal(manifest.readiness.ready, false);
  assert(manifest.readiness.findings.some((item) => item.code === 'missing_claims'));

  const review = await fs.readFile(path.join(casePath, 'build', 'review.md'), 'utf8');
  assert.match(review, /Structural validation: valid/);
  assert.match(review, /Case readiness: not ready/);
});
