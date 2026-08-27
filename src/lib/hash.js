import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { STAGE_SCOPES } from './constants.js';
import { listFilesRecursive, loadCase, pathExists, stableStringify, toPosix } from './io.js';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function hashFile(file) {
  return sha256(await fs.readFile(file));
}

async function collectScopeFiles(casePath, entries) {
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(casePath, entry);
    if (!(await pathExists(absolute))) {
      files.push({ path: entry, missing: true });
      continue;
    }
    const stat = await fs.stat(absolute);
    if (stat.isDirectory()) {
      const nested = await listFilesRecursive(absolute);
      for (const file of nested) {
        files.push({
          path: toPosix(path.relative(casePath, file)),
          hash: await hashFile(file),
        });
      }
    } else {
      files.push({ path: entry, hash: await hashFile(absolute) });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function computeStageHash(casePath, stage) {
  const scope = STAGE_SCOPES[stage];
  if (!scope) throw new Error(`unknown approval stage: ${stage}`);
  const data = await loadCase(casePath);
  const fields = Object.fromEntries(scope.fields.map((key) => [key, data[key]]));
  const files = await collectScopeFiles(casePath, scope.files);
  const payload = { stage, fields, files };
  return {
    hash: sha256(stableStringify(payload)),
    scope: [
      ...scope.fields.map((field) => `case.json#/${field}`),
      ...files.map((file) => file.path),
    ],
    payload,
  };
}

export async function computeDocumentHash(casePath) {
  const candidates = [
    '07-policy-proposal.md',
    'build/one-page-summary.md',
    'build/evidence-appendix.md',
  ];
  const files = await collectScopeFiles(casePath, candidates);
  return sha256(stableStringify(files));
}

export function dispatchKey(caseId, documentHash, recipientId) {
  return sha256(`${caseId}\n${documentHash}\n${recipientId}`);
}
