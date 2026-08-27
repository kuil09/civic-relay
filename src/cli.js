#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { approveCase } from './lib/approval.js';
import { buildCase } from './lib/build.js';
import {
  collaborationStatus,
  recordCollaborationEvent,
  registerParticipant,
} from './lib/collaboration.js';
import { initCase } from './lib/init.js';
import { listJurisdictionAdapters, loadJurisdictionAdapter } from './lib/jurisdiction.js';
import { buildLibrary, publishCase } from './lib/library.js';
import { dispatchCase, prepareDrafts } from './lib/mail.js';
import { redactCase } from './lib/privacy.js';
import { verifyRecipients } from './lib/recipients.js';
import { recordResponse } from './lib/responses.js';
import { loadCase } from './lib/io.js';
import { validateCaseDirectory } from './lib/validate.js';

function parse(tokens) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    const equal = body.indexOf('=');
    if (equal >= 0) {
      options[body.slice(0, equal)] = body.slice(equal + 1);
      continue;
    }
    const next = tokens[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      options[body] = next;
      index += 1;
    } else options[body] = true;
  }
  return { positionals, options };
}

function required(value, label) {
  if (value === undefined || value === null || value === '') throw new Error(`${label} is required`);
  return value;
}

function listOption(value) {
  return String(value || '')
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function printHelp() {
  console.log(`Civic Relay CLI

Commands:
  init <slug> [--root cases] [--title text] [--statement text]
  validate <case-path> [--json] [--for-send] [--max-age-hours 24]
  status <case-path>
  build <case-path>
  verify-recipients <case-path> [--max-age-hours 24]
  approve <case-path> --stage <stage> --actor <name> --confirm-human [--note text]
  draft-mail <case-path> [--require-current-recipients]
  dispatch <case-path> --mode draft|send [--max-age-hours 24]
  record-response <case-path> --recipient <id> --classification <type> --file <path> [--summary text]
  redact <case-path> [--output path]
  jurisdictions [--root path] [--json]
  jurisdiction <id> [--root path]
  collaboration-status <case-path> --target <file[#/pointer]> [--identity <id|id>]
  collaboration-add-participant <case-path> --id <participant-id> --name <display-name> --kind human|organization|ai --role <role|role> [--visibility private|public] [--recorded-by <id>] [--target <file>]
  collaboration-record <case-path> --type contribution|review|dissent|approval|co-sign-consent|consent-withdrawal --actor <id> --target <file[#/pointer]> [--identity <id>] [--consent-entry <id>] [--confirm-human] [--summary text]
  publish-case <redacted-case-path> --output <path> [--force]
  build-library <public-root> [--output <path>]
`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || ['help', '--help', '-h'].includes(command)) return printHelp();
  const { positionals, options } = parse(rest);

  if (command === 'init') {
    const slug = required(positionals[0], 'slug');
    const result = await initCase({ slug, root: options.root || 'cases', title: options.title || slug, statement: options.statement || '<사용자 원문을 입력하세요>' });
    console.log(result);
    return;
  }

  if (command === 'jurisdictions') {
    const root = options.root ? path.resolve(options.root) : undefined;
    const adapters = await listJurisdictionAdapters(root);
    if (options.json) console.log(JSON.stringify(adapters.map(({ file, ...item }) => item), null, 2));
    else for (const adapter of adapters) console.log(`${adapter.id}\t${adapter.name}\t${adapter.scope}`);
    return;
  }

  if (command === 'jurisdiction') {
    const id = required(positionals[0], 'jurisdiction id');
    const root = options.root ? path.resolve(options.root) : undefined;
    console.log(JSON.stringify(await loadJurisdictionAdapter(id, { root }), null, 2));
    return;
  }

  if (command === 'build-library') {
    const publicRoot = path.resolve(required(positionals[0], 'public root'));
    const output = options.output ? path.resolve(options.output) : path.join(publicRoot, 'library.json');
    console.log(JSON.stringify(await buildLibrary(publicRoot, output), null, 2));
    return;
  }

  if (command === 'publish-case') {
    const redactedCasePath = path.resolve(required(positionals[0], 'redacted case path'));
    const output = path.resolve(required(options.output, '--output'));
    console.log(JSON.stringify(await publishCase(redactedCasePath, output, { force: Boolean(options.force) }), null, 2));
    return;
  }

  const casePath = path.resolve(required(positionals[0], 'case path'));

  if (command === 'validate') {
    const result = await validateCaseDirectory(casePath, {
      forSend: Boolean(options['for-send']),
      maxAgeHours: Number(options['max-age-hours'] || 24),
    });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      for (const item of result.findings) console.log(`${item.severity.toUpperCase()} ${item.code} ${item.path}: ${item.message}`);
      console.log(result.valid ? 'VALID' : 'INVALID');
    }
    if (!result.valid) process.exitCode = 1;
    return;
  }

  if (command === 'status') {
    const data = await loadCase(casePath);
    const verification = verifyRecipients(data, { selectedOnly: true, maxAgeHours: 24 });
    console.log(JSON.stringify({
      case_id: data.case_id,
      title: data.title,
      status: data.status,
      claims: data.claims.length,
      sources: data.sources.length,
      options: data.options.length,
      counterarguments: data.counterarguments.length,
      recipients: data.recipients.length,
      selected_recipients: verification.selectedCount,
      approvals: data.approvals.map((item) => ({ stage: item.stage, actor: item.actor, approved_at: item.approved_at })),
      dispatches: data.dispatches.length,
      responses: data.responses.length,
    }, null, 2));
    return;
  }

  if (command === 'build') {
    console.log(JSON.stringify(await buildCase(casePath), null, 2));
    return;
  }

  if (command === 'collaboration-status') {
    console.log(JSON.stringify(await collaborationStatus(casePath, {
      target: required(options.target, '--target'),
      requiredIdentities: listOption(options.identity),
    }), null, 2));
    return;
  }

  if (command === 'verify-recipients') {
    const data = await loadCase(casePath);
    const result = verifyRecipients(data, { maxAgeHours: Number(options['max-age-hours'] || 24), selectedOnly: false });
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid && result.selectedCount > 0) process.exitCode = 1;
    return;
  }

  if (command === 'approve') {
    const approval = await approveCase(casePath, {
      stage: required(options.stage, '--stage'),
      actor: required(options.actor, '--actor'),
      confirmHuman: Boolean(options['confirm-human']),
      note: options.note || '',
    });
    console.log(JSON.stringify(approval, null, 2));
    return;
  }

  if (command === 'draft-mail') {
    console.log(JSON.stringify(await prepareDrafts(casePath, { requireCurrentRecipients: Boolean(options['require-current-recipients']) }), null, 2));
    return;
  }

  if (command === 'dispatch') {
    console.log(JSON.stringify(await dispatchCase(casePath, { mode: options.mode || 'draft', maxAgeHours: Number(options['max-age-hours'] || 24) }), null, 2));
    return;
  }

  if (command === 'record-response') {
    const response = await recordResponse(casePath, {
      recipientId: required(options.recipient, '--recipient'),
      classification: required(options.classification, '--classification'),
      sourceFile: path.resolve(required(options.file, '--file')),
      summary: options.summary || '',
      followUpTasks: options['follow-up'] ? String(options['follow-up']).split('|').filter(Boolean) : [],
    });
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (command === 'redact') {
    const output = options.output ? path.resolve(options.output) : `${casePath}-public`;
    console.log(JSON.stringify(await redactCase(casePath, output), null, 2));
    return;
  }

  if (command === 'collaboration-add-participant') {
    console.log(JSON.stringify(await registerParticipant(casePath, {
      participantId: required(options.id, '--id'),
      displayName: required(options.name, '--name'),
      participantKind: required(options.kind, '--kind'),
      roles: listOption(required(options.role, '--role')),
      visibility: options.visibility || 'private',
      recordedBy: options['recorded-by'] || options.id,
      target: options.target || 'case.json',
    }), null, 2));
    return;
  }

  if (command === 'collaboration-record') {
    console.log(JSON.stringify(await recordCollaborationEvent(casePath, {
      eventType: required(options.type, '--type'),
      actorId: required(options.actor, '--actor'),
      target: required(options.target, '--target'),
      identityId: options.identity || null,
      consentEntryId: options['consent-entry'] || null,
      confirmHuman: Boolean(options['confirm-human']),
      summary: options.summary || '',
    }), null, 2));
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
