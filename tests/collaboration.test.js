import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  collaborationStatus,
  loadCollaborationLedger,
  recordCollaborationEvent,
  registerParticipant,
  validateCollaborationLedger,
} from '../src/lib/collaboration.js';
import { initCase } from '../src/lib/init.js';
import { redactCase } from '../src/lib/privacy.js';
import { validateCaseDirectory } from '../src/lib/validate.js';
import { repositoryRoot, tempDirectory } from './helpers.js';

const execFileAsync = promisify(execFile);

async function createCase(slug) {
  const root = await tempDirectory();
  return initCase({ slug, root, title: slug, statement: 'Original statement' });
}

async function addHuman(casePath, id = 'author-1', visibility = 'private', roles = ['case_author']) {
  return registerParticipant(casePath, {
    participantId: id,
    displayName: 'Human Author',
    participantKind: 'human',
    roles,
    visibility,
  });
}

async function recordDivergentVersions(casePath, actorId = 'author-1') {
  const target = '07-policy-proposal.md';
  const first = await recordCollaborationEvent(casePath, {
    eventType: 'contribution', actorId, target, summary: 'Recorded the first candidate version.',
  });
  await fs.appendFile(path.join(casePath, target), '\nCandidate revision.\n');
  const second = await recordCollaborationEvent(casePath, {
    eventType: 'contribution', actorId, target, summary: 'Recorded the second candidate version.',
  });
  return { target, first, second };
}

test('collaboration remains optional for legacy and local-only cases', async () => {
  const casePath = await createCase('optional-collaboration');
  await assert.rejects(() => fs.stat(path.join(casePath, 'collaboration.json')), { code: 'ENOENT' });

  const status = await collaborationStatus(casePath, { target: '07-policy-proposal.md' });
  const validation = await validateCaseDirectory(casePath);
  assert.equal(status.enabled, false);
  assert.equal(validation.valid, true, JSON.stringify(validation.findings));
});

test('the existing CLI validates a case without public or collaboration features', async () => {
  const casePath = await createCase('legacy-cli');
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(repositoryRoot, 'src', 'cli.js'),
    'validate',
    casePath,
    '--json',
  ]);
  assert.equal(JSON.parse(stdout).valid, true);
});

test('the CLI records and resolves a conflict through the production entrypoint', async () => {
  const casePath = await createCase('conflict-cli');
  const cli = path.join(repositoryRoot, 'src', 'cli.js');
  await execFileAsync(process.execPath, [
    cli,
    'collaboration-add-participant',
    casePath,
    '--id', 'author-1',
    '--name', 'Human Author',
    '--kind', 'human',
    '--role', 'case_author',
  ]);
  const first = JSON.parse((await execFileAsync(process.execPath, [
    cli,
    'collaboration-record',
    casePath,
    '--type', 'contribution',
    '--actor', 'author-1',
    '--target', '07-policy-proposal.md',
  ])).stdout);
  await fs.appendFile(path.join(casePath, '07-policy-proposal.md'), '\nCLI candidate revision.\n');
  const second = JSON.parse((await execFileAsync(process.execPath, [
    cli,
    'collaboration-record',
    casePath,
    '--type', 'contribution',
    '--actor', 'author-1',
    '--target', '07-policy-proposal.md',
  ])).stdout);
  const conflict = JSON.parse((await execFileAsync(process.execPath, [
    cli,
    'collaboration-record',
    casePath,
    '--type', 'conflict-opened',
    '--actor', 'author-1',
    '--target', '07-policy-proposal.md',
    '--conflicting-entry', `${first.entry_id}|${second.entry_id}`,
  ])).stdout);
  await execFileAsync(process.execPath, [
    cli,
    'collaboration-record',
    casePath,
    '--type', 'conflict-resolved',
    '--actor', 'author-1',
    '--target', '07-policy-proposal.md',
    '--conflict-entry', conflict.entry_id,
    '--outcome', 'adopt_current',
    '--confirm-human',
  ]);
  const status = JSON.parse((await execFileAsync(process.execPath, [
    cli,
    'collaboration-status',
    casePath,
    '--target', '07-policy-proposal.md',
  ])).stdout);

  assert.equal(status.resolved_conflicts.length, 1);
  assert.equal(status.resolved_conflicts[0].current_resolution.outcome, 'adopt_current');
});

test('participants and event kinds remain distinct in an append-only hash chain', async () => {
  const casePath = await createCase('collaboration-events');
  await addHuman(casePath);

  await recordCollaborationEvent(casePath, {
    eventType: 'contribution', actorId: 'author-1', target: 'case.json#/claims', summary: 'Drafted a claim.',
  });
  await recordCollaborationEvent(casePath, {
    eventType: 'review', actorId: 'author-1', target: '07-policy-proposal.md', summary: 'Reviewed the draft.',
  });
  await recordCollaborationEvent(casePath, {
    eventType: 'dissent', actorId: 'author-1', target: '07-policy-proposal.md', summary: 'Recorded a dissent.',
  });
  await recordCollaborationEvent(casePath, {
    eventType: 'approval', actorId: 'author-1', target: '07-policy-proposal.md', confirmHuman: true, summary: 'Approved for collaboration review.',
  });

  const ledger = await loadCollaborationLedger(casePath, { required: true });
  assert.deepEqual(ledger.entries.map((entry) => entry.event_type), [
    'participant_registered',
    'contribution',
    'review',
    'dissent',
    'approval',
  ]);
  assert.equal(validateCollaborationLedger(ledger, { caseId: 'collaboration-events' }).valid, true);
  assert.equal(ledger.entries[1].previous_entry_hash, ledger.entries[0].entry_hash);
});

test('a conflict must reference prior entries for different versions of the same target', async () => {
  const casePath = await createCase('conflict-candidates');
  await addHuman(casePath);
  const target = '07-policy-proposal.md';
  const first = await recordCollaborationEvent(casePath, {
    eventType: 'contribution', actorId: 'author-1', target,
  });
  const sameVersion = await recordCollaborationEvent(casePath, {
    eventType: 'review', actorId: 'author-1', target,
  });

  await assert.rejects(() => recordCollaborationEvent(casePath, {
    eventType: 'conflict_opened',
    actorId: 'author-1',
    target,
    conflictingEntryIds: [first.entry_id, sameVersion.entry_id],
  }), /at least two document hashes/);

  await fs.appendFile(path.join(casePath, target), '\nDivergent version.\n');
  const divergent = await recordCollaborationEvent(casePath, {
    eventType: 'contribution', actorId: 'author-1', target,
  });
  const conflict = await recordCollaborationEvent(casePath, {
    eventType: 'conflict_opened',
    actorId: 'author-1',
    target,
    conflictingEntryIds: [first.entry_id, divergent.entry_id],
  });

  assert.deepEqual(conflict.payload.conflicting_entry_ids, [first.entry_id, divergent.entry_id]);
});

test('unresolved conflicts block joint attribution and human resolution expires after revision', async () => {
  const casePath = await createCase('conflict-lifecycle');
  await addHuman(casePath);
  const { target, first, second } = await recordDivergentVersions(casePath);
  await recordCollaborationEvent(casePath, {
    eventType: 'co_sign_consent', actorId: 'author-1', target, confirmHuman: true,
  });
  const conflict = await recordCollaborationEvent(casePath, {
    eventType: 'conflict_opened',
    actorId: 'author-1',
    target,
    conflictingEntryIds: [first.entry_id, second.entry_id],
    summary: 'The two versions make incompatible policy requests.',
  });

  const unresolved = await collaborationStatus(casePath, {
    target,
    requiredIdentities: ['author-1'],
  });
  assert.equal(unresolved.current_consents.length, 1);
  assert.equal(unresolved.joint_attribution_valid, false);
  assert.equal(unresolved.reason, 'unresolved_conflicts');
  assert.equal(unresolved.unresolved_conflicts.length, 1);
  assert.equal(unresolved.document_versions.length, 2);

  await assert.rejects(() => recordCollaborationEvent(casePath, {
    eventType: 'conflict_resolved',
    actorId: 'author-1',
    target,
    conflictEntryId: conflict.entry_id,
    outcome: 'merged',
  }), /requires --confirm-human/);

  const resolution = await recordCollaborationEvent(casePath, {
    eventType: 'conflict_resolved',
    actorId: 'author-1',
    target,
    conflictEntryId: conflict.entry_id,
    outcome: 'merged',
    confirmHuman: true,
    summary: 'Merged the compatible evidence and retained the narrower request.',
  });
  const resolved = await collaborationStatus(casePath, {
    target,
    requiredIdentities: ['author-1'],
  });
  assert.equal(resolved.joint_attribution_valid, true);
  assert.equal(resolved.resolved_conflicts[0].current_resolution.entry_id, resolution.entry_id);

  await fs.appendFile(path.join(casePath, target), '\nPost-resolution revision.\n');
  await recordCollaborationEvent(casePath, {
    eventType: 'co_sign_consent', actorId: 'author-1', target, confirmHuman: true,
  });
  const stale = await collaborationStatus(casePath, {
    target,
    requiredIdentities: ['author-1'],
  });
  assert.equal(stale.current_consents.length, 1);
  assert.equal(stale.joint_attribution_valid, false);
  assert.equal(stale.reason, 'unresolved_conflicts');
  assert.equal(stale.unresolved_conflicts[0].stale_resolutions[0].entry_id, resolution.entry_id);

  const validation = await validateCaseDirectory(casePath);
  assert(validation.findings.some((item) => item.code === 'unresolved_collaboration_conflict'));
  assert(validation.findings.some((item) => item.code === 'stale_conflict_resolution'));
});

test('participation never becomes joint attribution without explicit current consent', async () => {
  const casePath = await createCase('explicit-consent');
  await addHuman(casePath, 'author-1', 'private', ['case_author', 'public_release_manager']);
  await registerParticipant(casePath, {
    participantId: 'civic-org',
    displayName: 'Civic Organization',
    participantKind: 'organization',
    roles: ['public_release_manager'],
    visibility: 'public',
    recordedBy: 'author-1',
  });
  await recordCollaborationEvent(casePath, {
    eventType: 'contribution', actorId: 'author-1', target: '07-policy-proposal.md', summary: 'Edited the proposal.',
  });

  const before = await collaborationStatus(casePath, {
    target: '07-policy-proposal.md',
    requiredIdentities: ['author-1', 'civic-org'],
  });
  assert.equal(before.current_consents.length, 0);
  assert.equal(before.joint_attribution_valid, false);
  assert.equal(before.reason, 'explicit_current_consent_missing');

  await assert.rejects(() => recordCollaborationEvent(casePath, {
    eventType: 'co_sign_consent', actorId: 'author-1', target: '07-policy-proposal.md',
  }), /requires --confirm-human/);

  await recordCollaborationEvent(casePath, {
    eventType: 'co_sign_consent',
    actorId: 'author-1',
    identityId: 'author-1',
    target: '07-policy-proposal.md',
    confirmHuman: true,
    summary: 'Explicitly consents to this document snapshot.',
  });
  const partial = await collaborationStatus(casePath, {
    target: '07-policy-proposal.md',
    requiredIdentities: ['author-1', 'civic-org'],
  });
  assert.equal(partial.joint_attribution_valid, false);
  assert.deepEqual(partial.missing_identities, ['civic-org']);

  await recordCollaborationEvent(casePath, {
    eventType: 'co_sign_consent',
    actorId: 'author-1',
    identityId: 'civic-org',
    target: '07-policy-proposal.md',
    confirmHuman: true,
    summary: 'The human actor explicitly records the organization position.',
  });
  const after = await collaborationStatus(casePath, {
    target: '07-policy-proposal.md',
    requiredIdentities: ['author-1', 'civic-org'],
  });
  assert.equal(after.joint_attribution_valid, true);
  assert.equal(after.current_consents.length, 2);
});

test('document changes expire prior co-sign consent without deleting history', async () => {
  const casePath = await createCase('stale-consent');
  await addHuman(casePath);
  const consent = await recordCollaborationEvent(casePath, {
    eventType: 'co_sign_consent', actorId: 'author-1', target: '07-policy-proposal.md', confirmHuman: true,
  });

  await fs.appendFile(path.join(casePath, '07-policy-proposal.md'), '\nRevised content.\n');
  const status = await collaborationStatus(casePath, {
    target: '07-policy-proposal.md',
    requiredIdentities: ['author-1'],
  });
  assert.equal(status.joint_attribution_valid, false);
  assert.equal(status.current_consents.length, 0);
  assert.equal(status.stale_consents[0].entry_id, consent.entry_id);

  const validation = await validateCaseDirectory(casePath);
  assert(validation.findings.some((item) => item.code === 'stale_consent'));
});

test('AI actors cannot create human approval, consent, signature, or conflict resolution records', async () => {
  const casePath = await createCase('ai-collaboration');
  await registerParticipant(casePath, {
    participantId: 'assistant-1',
    displayName: 'Codex Agent',
    participantKind: 'ai',
    roles: ['policy_editor'],
    visibility: 'private',
  });

  for (const eventType of ['approval', 'co_sign_consent']) {
    await assert.rejects(() => recordCollaborationEvent(casePath, {
      eventType,
      actorId: 'assistant-1',
      target: '07-policy-proposal.md',
      confirmHuman: true,
    }), /requires a human actor/);
  }
  await registerParticipant(casePath, {
    participantId: 'author-1',
    displayName: 'Human Author',
    participantKind: 'human',
    roles: ['case_author'],
    visibility: 'private',
    recordedBy: 'assistant-1',
  });
  const { target, first, second } = await recordDivergentVersions(casePath, 'author-1');
  const conflict = await recordCollaborationEvent(casePath, {
    eventType: 'conflict_opened',
    actorId: 'assistant-1',
    target,
    conflictingEntryIds: [first.entry_id, second.entry_id],
  });
  await assert.rejects(() => recordCollaborationEvent(casePath, {
    eventType: 'conflict_resolved',
    actorId: 'assistant-1',
    target,
    conflictEntryId: conflict.entry_id,
    outcome: 'adopt_current',
    confirmHuman: true,
  }), /requires a human actor/);

  const ledger = await loadCollaborationLedger(casePath, { required: true });
  assert.equal(ledger.entries.at(-1).event_type, 'conflict_opened');
});

test('a consent withdrawal is appended and invalidates only the referenced consent', async () => {
  const casePath = await createCase('withdraw-consent');
  await addHuman(casePath);
  const consent = await recordCollaborationEvent(casePath, {
    eventType: 'co_sign_consent', actorId: 'author-1', target: '07-policy-proposal.md', confirmHuman: true,
  });
  const withdrawal = await recordCollaborationEvent(casePath, {
    eventType: 'consent_withdrawal',
    actorId: 'author-1',
    target: '07-policy-proposal.md',
    consentEntryId: consent.entry_id,
    confirmHuman: true,
  });

  const status = await collaborationStatus(casePath, {
    target: '07-policy-proposal.md',
    requiredIdentities: ['author-1'],
  });
  const ledger = await loadCollaborationLedger(casePath, { required: true });
  assert.equal(status.current_consents.length, 0);
  assert.equal(status.withdrawn_consents[0].entry_id, consent.entry_id);
  assert.equal(ledger.entries.at(-1).entry_id, withdrawal.entry_id);
});

test('public redaction pseudonymizes private participants and preserves ledger integrity', async () => {
  const casePath = await createCase('public-collaboration');
  await registerParticipant(casePath, {
    participantId: 'private-author',
    displayName: 'Private Person',
    participantKind: 'human',
    roles: ['case_author'],
    visibility: 'private',
  });
  await registerParticipant(casePath, {
    participantId: 'public-org',
    displayName: 'Civic Lab',
    participantKind: 'organization',
    roles: ['public_release_manager'],
    visibility: 'public',
    recordedBy: 'private-author',
  });
  const firstVersion = await recordCollaborationEvent(casePath, {
    eventType: 'contribution',
    actorId: 'private-author',
    target: '07-policy-proposal.md',
    summary: 'Private Person (private-author) uses private.person@example.invalid.',
  });
  await recordCollaborationEvent(casePath, {
    eventType: 'co_sign_consent',
    actorId: 'private-author',
    identityId: 'private-author',
    target: '07-policy-proposal.md',
    confirmHuman: true,
  });
  await fs.appendFile(path.join(casePath, '07-policy-proposal.md'), '\nPublic candidate revision.\n');
  const secondVersion = await recordCollaborationEvent(casePath, {
    eventType: 'contribution',
    actorId: 'private-author',
    target: '07-policy-proposal.md',
    summary: 'Private Person recorded the revised candidate.',
  });
  const conflict = await recordCollaborationEvent(casePath, {
    eventType: 'conflict_opened',
    actorId: 'private-author',
    target: '07-policy-proposal.md',
    conflictingEntryIds: [firstVersion.entry_id, secondVersion.entry_id],
    summary: 'Private Person compared the candidates.',
  });
  await recordCollaborationEvent(casePath, {
    eventType: 'conflict_resolved',
    actorId: 'private-author',
    target: '07-policy-proposal.md',
    conflictEntryId: conflict.entry_id,
    outcome: 'adopt_current',
    confirmHuman: true,
    summary: 'Private Person selected the current version.',
  });

  const output = path.join(await tempDirectory(), 'public');
  await redactCase(casePath, output);
  const text = await fs.readFile(path.join(output, 'collaboration.json'), 'utf8');
  const publicLedger = JSON.parse(text);
  assert.equal(text.includes('private-author'), false);
  assert.equal(text.includes('Private Person'), false);
  assert.equal(text.includes('private.person@example.invalid'), false);
  assert.equal(text.includes('private-participant-001'), true);
  assert.equal(text.includes('public-org'), true);
  assert.equal(publicLedger.public_copy, true);
  assert.equal(validateCollaborationLedger(publicLedger, { caseId: 'public-collaboration' }).valid, true);

  const publicStatus = await collaborationStatus(output, {
    target: '07-policy-proposal.md',
    requiredIdentities: ['private-participant-001'],
  });
  assert.equal(publicStatus.joint_attribution_valid, false);
  assert.equal(publicStatus.reason, 'public_copy_non_authoritative');
  assert.equal(publicStatus.current_consents.length, 0);
  assert.equal(publicStatus.stale_consents.length, 1);
  assert.equal(publicStatus.resolved_conflicts.length, 0);
  assert.equal(publicStatus.unresolved_conflicts.length, 1);
  assert.equal(publicStatus.unresolved_conflicts[0].stale_resolutions.length, 1);
});

test('validation rejects tampered ledger content with a file-specific contract error', async () => {
  const casePath = await createCase('tampered-ledger');
  await addHuman(casePath);
  const file = path.join(casePath, 'collaboration.json');
  const ledger = JSON.parse(await fs.readFile(file, 'utf8'));
  ledger.entries[0].payload.display_name = 'Changed without rechaining';
  await fs.writeFile(file, `${JSON.stringify(ledger, null, 2)}\n`);

  const validation = await validateCaseDirectory(casePath);
  assert.equal(validation.valid, false);
  assert(validation.findings.some((item) => item.code === 'collaboration_contract' && item.message.includes('entry_hash')));
});
