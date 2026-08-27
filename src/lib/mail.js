import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { approvalState } from './approval.js';
import { computeDocumentHash, dispatchKey } from './hash.js';
import { ensureDir, listFilesRecursive, loadCase, nowIso, pathExists, safeFileName, saveCase, writeJsonAtomic, writeTextAtomic } from './io.js';
import { verifyRecipients } from './recipients.js';

function parseFrontMatter(text) {
  if (!text.startsWith('---\n')) return { meta: {}, body: text };
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return { meta: {}, body: text };
  const raw = text.slice(4, end);
  const meta = {};
  for (const line of raw.split('\n')) {
    const index = line.indexOf(':');
    if (index < 0) continue;
    meta[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return { meta, body: text.slice(end + 5).trim() };
}

function safeHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function eml({ to, subject, body, replyTo = null }) {
  const headers = [
    `To: ${safeHeader(to)}`,
    `Subject: ${safeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  if (replyTo) headers.splice(1, 0, `Reply-To: ${safeHeader(replyTo)}`);
  return `${headers.join('\r\n')}\r\n\r\n${body.replaceAll('\n', '\r\n')}\r\n`;
}

async function readCoverMap(casePath) {
  const directory = path.join(casePath, '09-cover-emails');
  const map = new Map();
  if (!(await pathExists(directory))) return map;
  for (const file of await listFilesRecursive(directory)) {
    if (path.extname(file).toLowerCase() !== '.md') continue;
    const parsed = parseFrontMatter(await fs.readFile(file, 'utf8'));
    if (parsed.meta.recipient_id) map.set(parsed.meta.recipient_id, { file, ...parsed });
  }
  return map;
}

async function requireDraftApprovals(casePath, data) {
  for (const stage of ['problem', 'evidence', 'policy', 'recipients', 'document']) {
    const state = await approvalState(casePath, stage, data);
    if (!state.valid) throw new Error(`draft packaging requires current ${stage} approval: ${state.reason}`);
  }
}

function channelPayload(recipient) {
  const channel = recipient.official_channel || '';
  if (channel.startsWith('mailto:')) return { type: 'email', value: channel.slice('mailto:'.length) };
  if (channel.startsWith('https://')) return { type: 'web_form', value: channel };
  if (channel.startsWith('postal:')) return { type: 'postal', value: channel.slice('postal:'.length) };
  if (channel.startsWith('tel:')) return { type: 'phone_script', value: channel.slice('tel:'.length) };
  return { type: 'none', value: channel };
}

export async function prepareDrafts(casePath, options = {}) {
  const { maxAgeHours = 24, requireCurrentRecipients = false } = options;
  const data = await loadCase(casePath);
  await requireDraftApprovals(casePath, data);
  const selected = (data.recipients || []).filter((item) => item.selected);
  if (!selected.length) throw new Error('no selected recipients');
  if (requireCurrentRecipients) {
    const verification = verifyRecipients(data, { maxAgeHours, selectedOnly: true });
    if (!verification.valid) throw new Error(`recipient verification failed: ${JSON.stringify(verification.results.filter((item) => !item.valid))}`);
  }

  const coverMap = await readCoverMap(casePath);
  const outbox = path.join(casePath, 'build', 'outbox');
  await ensureDir(outbox);
  const documentHash = await computeDocumentHash(casePath);
  const createdAt = nowIso();
  const records = [];

  const distribution = selected.map((item) => item.organization);
  await writeTextAtomic(
    path.join(casePath, 'build', 'distribution-notice.md'),
    `# 배포 고지\n\n동일한 핵심 정책 문서는 다음 수신자에게 개별 전달하도록 준비되었다.\n\n${distribution.map((item) => `- ${item}`).join('\n')}\n\n수신자 주소는 상호 노출하지 않는다.\n`,
  );

  for (const recipient of selected) {
    const cover = coverMap.get(recipient.recipient_id);
    if (!cover) throw new Error(`missing cover email for ${recipient.recipient_id}`);
    const subject = cover.meta.subject || `[정책 검토 요청] ${data.title}`;
    const channel = channelPayload(recipient);
    const fileBase = safeFileName(recipient.recipient_id);
    let output;
    if (channel.type === 'email') {
      output = path.join(outbox, `${fileBase}.eml`);
      await fs.writeFile(output, eml({ to: channel.value, subject, body: cover.body }), 'utf8');
    } else {
      output = path.join(outbox, `${fileBase}.md`);
      await writeTextAtomic(output, `# ${subject}\n\n- 채널: ${channel.type}\n- 공식 경로: ${channel.value}\n- 수신자: ${recipient.organization}\n\n${cover.body}\n`);
    }
    const key = dispatchKey(data.case_id, documentHash, recipient.recipient_id);
    records.push({
      dispatch_id: `dispatch-${randomUUID()}`,
      dispatch_key: key,
      recipient_id: recipient.recipient_id,
      mode: 'draft',
      channel: channel.type,
      subject,
      document_hash: documentHash,
      approval_id: null,
      created_at: createdAt,
      sent_at: null,
      provider_message_id: null,
      status: 'drafted',
      failure_reason: null,
      alternative_channel: channel.type === 'email' ? null : channel.value,
      output_file: path.relative(casePath, output).split(path.sep).join('/'),
    });
  }

  data.dispatches ||= [];
  const oldDraftKeys = new Set(records.map((item) => item.dispatch_key));
  data.dispatches = data.dispatches.filter((item) => !(item.status === 'drafted' && oldDraftKeys.has(item.dispatch_key)));
  data.dispatches.push(...records);
  await saveCase(casePath, data);
  await writeJsonAtomic(path.join(casePath, '10-dispatch-manifest.json'), {
    schema_version: '0.1',
    case_id: data.case_id,
    mode: 'draft',
    document_hash: documentHash,
    distribution_categories: distribution,
    created_at: createdAt,
    dispatches: records,
  });
  return records;
}

async function runAdapter(executable, request, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`mail adapter timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`mail adapter exited ${code}: ${stderr.trim()}`));
      try {
        const response = JSON.parse(stdout);
        resolve(response);
      } catch (error) {
        reject(new Error(`mail adapter returned invalid JSON: ${error.message}`));
      }
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

export async function dispatchCase(casePath, options = {}) {
  const { mode = 'draft', maxAgeHours = 24 } = options;
  if (mode === 'draft') return prepareDrafts(casePath, { maxAgeHours, requireCurrentRecipients: false });
  if (mode !== 'send') throw new Error(`unsupported dispatch mode: ${mode}`);

  const data = await loadCase(casePath);
  for (const stage of ['problem', 'evidence', 'policy', 'recipients', 'document', 'dispatch']) {
    const state = await approvalState(casePath, stage, data);
    if (!state.valid) throw new Error(`send blocked: ${stage} approval is ${state.reason}`);
  }
  const verification = verifyRecipients(data, { maxAgeHours, selectedOnly: true });
  if (!verification.valid || verification.selectedCount === 0) throw new Error('send blocked: recipient verification is missing, stale, or invalid');
  const executable = process.env.CIVIC_RELAY_MAIL_ADAPTER;
  if (!executable) throw new Error('send blocked: CIVIC_RELAY_MAIL_ADAPTER is not configured');

  const documentHash = await computeDocumentHash(casePath);
  const covers = await readCoverMap(casePath);
  const dispatchApproval = (data.approvals || []).filter((item) => item.stage === 'dispatch').sort((a, b) => b.approved_at.localeCompare(a.approved_at))[0];
  const successful = new Set((data.dispatches || []).filter((item) => item.status === 'sent').map((item) => item.dispatch_key));
  const results = [];

  for (const recipient of data.recipients.filter((item) => item.selected)) {
    const key = dispatchKey(data.case_id, documentHash, recipient.recipient_id);
    if (successful.has(key)) throw new Error(`duplicate send blocked for ${recipient.recipient_id}`);
    const cover = covers.get(recipient.recipient_id);
    if (!cover) throw new Error(`missing cover email for ${recipient.recipient_id}`);
    const channel = channelPayload(recipient);
    if (channel.type !== 'email') throw new Error(`automatic send only supports email adapter; ${recipient.recipient_id} uses ${channel.type}`);
    const subject = cover.meta.subject || `[정책 검토 요청] ${data.title}`;
    const request = {
      protocol: 'civic-relay-mail-adapter/v1',
      case_id: data.case_id,
      recipient: { id: recipient.recipient_id, address: channel.value, organization: recipient.organization },
      message: { subject, text: cover.body },
      document_hash: documentHash,
      dispatch_key: key,
    };
    const createdAt = nowIso();
    try {
      const response = await runAdapter(executable, request);
      const record = {
        dispatch_id: `dispatch-${randomUUID()}`,
        dispatch_key: key,
        recipient_id: recipient.recipient_id,
        mode: 'send',
        channel: 'email',
        subject,
        document_hash: documentHash,
        approval_id: dispatchApproval.approval_id,
        created_at: createdAt,
        sent_at: response.status === 'sent' ? nowIso() : null,
        provider_message_id: response.message_id || null,
        status: response.status === 'sent' ? 'sent' : 'failed',
        failure_reason: response.error || null,
        alternative_channel: null,
      };
      data.dispatches.push(record);
      results.push(record);
    } catch (error) {
      const record = {
        dispatch_id: `dispatch-${randomUUID()}`,
        dispatch_key: key,
        recipient_id: recipient.recipient_id,
        mode: 'send',
        channel: 'email',
        subject,
        document_hash: documentHash,
        approval_id: dispatchApproval.approval_id,
        created_at: createdAt,
        sent_at: null,
        provider_message_id: null,
        status: 'failed',
        failure_reason: error.message,
        alternative_channel: null,
      };
      data.dispatches.push(record);
      results.push(record);
    }
  }
  if (results.some((item) => item.status === 'sent')) data.status = 'dispatched';
  await saveCase(casePath, data);
  await writeJsonAtomic(path.join(casePath, '10-dispatch-manifest.json'), {
    schema_version: '0.1', case_id: data.case_id, mode: 'send', document_hash: documentHash,
    distribution_categories: data.recipients.filter((item) => item.selected).map((item) => item.organization),
    created_at: nowIso(), dispatches: results,
  });
  return results;
}
