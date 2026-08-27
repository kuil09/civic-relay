import { promises as fs } from 'node:fs';
import path from 'node:path';
import { rechainCollaborationLedger, sanitizeCollaborationLedgerForPublic } from './collaboration.js';
import { hashFile, sha256 } from './hash.js';
import {
  ensureDir,
  listFilesRecursive,
  pathExists,
  stableStringify,
  toPosix,
  writeJsonAtomic,
  writeTextAtomic,
} from './io.js';

const PATTERNS = [
  { kind: 'secret', label: 'private-key', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { kind: 'secret', label: 'github-token', regex: /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}\b/g },
  { kind: 'secret', label: 'openai-style-token', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'secret', label: 'aws-access-key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'secret', label: 'bearer-token', regex: /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}=*/gi },
  { kind: 'pii', label: 'email', regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { kind: 'pii', label: 'kr-phone', regex: /\b(?:01[016789]|0\d{1,2})[- .]?\d{3,4}[- .]?\d{4}\b/g },
];

const LOCAL_PATH_PATTERNS = [
  { label: 'posix-local-path', regex: /(?:^|[\s"'`(])\/(?:Users|home|tmp|mnt|private|var\/tmp)\/[^\s"'`)]+/gm },
  { label: 'windows-local-path', regex: /(?:^|[\s"'`(])[A-Za-z]:[\\/][^\s"'`)]+/gm },
  { label: 'file-url', regex: /file:\/\/[^\s"'`)]+/gim },
  { label: 'tilde-home-path', regex: /(?:^|[\s"'`(])~[\\/][^\s"'`)]+/gm },
  { label: 'environment-home-path', regex: /(?:\$(?:HOME|USERPROFILE)|\$\{(?:HOME|USERPROFILE)\}|%(?:USERPROFILE|HOMEPATH)%)[\\/][^\s"'`)]+/gim },
];

export function scanText(text) {
  const results = [];
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    for (const match of text.matchAll(pattern.regex)) {
      results.push({ kind: pattern.kind, label: pattern.label, index: match.index, length: match[0].length });
    }
  }
  return results;
}

export function scanLocalPaths(text) {
  const results = [];
  for (const pattern of LOCAL_PATH_PATTERNS) {
    pattern.regex.lastIndex = 0;
    for (const match of String(text).matchAll(pattern.regex)) {
      results.push({ label: pattern.label, index: match.index, length: match[0].length });
    }
  }
  return results;
}

export function redactText(text) {
  let result = text;
  const counts = {};
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    const matches = [...result.matchAll(pattern.regex)];
    if (!matches.length) continue;
    counts[pattern.label] = (counts[pattern.label] || 0) + matches.length;
    result = result.replace(pattern.regex, pattern.kind === 'secret' ? '[REDACTED_SECRET]' : `[REDACTED_${pattern.label.toUpperCase().replaceAll('-', '_')}]`);
  }
  return { text: result, counts };
}

function isTextFile(file) {
  return ['.md', '.json', '.csv', '.txt', '.yaml', '.yml', '.eml'].includes(path.extname(file).toLowerCase());
}

function hasRedactions(redactions) {
  return Object.values(redactions).some((count) => Number(count) > 0);
}

export async function redactCase(casePath, outputPath = `${casePath}-public`) {
  if (await pathExists(outputPath)) throw new Error(`output already exists: ${outputPath}`);
  const files = await listFilesRecursive(casePath, { ignore: ['build/outbox', 'public'] });
  const sourceFiles = await Promise.all(files.map(async (file) => ({
    path: toPosix(path.relative(casePath, file)),
    hash: await hashFile(file),
  })));
  sourceFiles.sort((left, right) => left.path.localeCompare(right.path));
  const sourceHashByPath = new Map(sourceFiles.map((file) => [file.path, file.hash]));
  const manifest = {
    schema_version: '2.0',
    created_at: new Date().toISOString(),
    source_snapshot_hash: sha256(stableStringify(sourceFiles)),
    files: [],
  };
  for (const file of files) {
    const relative = toPosix(path.relative(casePath, file));
    const target = path.join(outputPath, relative);
    await ensureDir(path.dirname(target));
    if (!isTextFile(file)) {
      await fs.copyFile(file, target);
      manifest.files.push({
        path: relative,
        handling: 'copied_binary',
        copied: true,
        redacted: false,
        source_hash: sourceHashByPath.get(relative),
        output_hash: await hashFile(target),
        redactions: {},
      });
      continue;
    }
    const raw = await fs.readFile(file, 'utf8');
    if (relative === 'collaboration.json') {
      const sanitized = sanitizeCollaborationLedgerForPublic(JSON.parse(raw));
      const textRedaction = redactText(JSON.stringify(sanitized.ledger));
      const publicLedger = rechainCollaborationLedger(JSON.parse(textRedaction.text));
      await writeJsonAtomic(target, publicLedger);
      const redactions = {
        ...textRedaction.counts,
        private_participants: sanitized.redactedParticipants,
      };
      manifest.files.push({
        path: relative,
        handling: 'processed_text',
        copied: false,
        redacted: hasRedactions(redactions),
        source_hash: sourceHashByPath.get(relative),
        output_hash: await hashFile(target),
        redactions,
      });
      continue;
    }
    const redacted = redactText(raw);
    await writeTextAtomic(target, redacted.text);
    manifest.files.push({
      path: relative,
      handling: 'processed_text',
      copied: false,
      redacted: hasRedactions(redacted.counts),
      source_hash: sourceHashByPath.get(relative),
      output_hash: await hashFile(target),
      redactions: redacted.counts,
    });
  }
  await writeJsonAtomic(path.join(outputPath, 'redaction-manifest.json'), manifest);
  return manifest;
}
