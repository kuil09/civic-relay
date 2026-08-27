import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function tempDirectory(prefix = 'civic-relay-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function copyExample() {
  const targetRoot = await tempDirectory();
  const target = path.join(targetRoot, 'case');
  await fs.cp(path.join(repositoryRoot, 'examples', 'apartment-night-delivery'), target, { recursive: true });
  return target;
}

export async function writeRecipientCsv(casePath, recipients) {
  const header = 'recipient_id,organization,role,jurisdiction_type,reason,expected_action,channel_type,official_channel,channel_source,verified_at,verification_status,selected,status\n';
  const rows = recipients.map((r) => [r.recipient_id, r.organization, r.role, r.jurisdiction_type, r.reason, r.expected_action, r.channel_type, r.official_channel || '', r.channel_source || '', r.verified_at || '', r.verification_status, String(r.selected), r.status]
    .map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','));
  await fs.writeFile(path.join(casePath, '08-recipient-matrix.csv'), `${header}${rows.join('\n')}\n`, 'utf8');
}
