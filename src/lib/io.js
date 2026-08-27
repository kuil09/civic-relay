import { promises as fs } from 'node:fs';
import path from 'node:path';

export function nowIso() {
  return new Date().toISOString();
}

export function toPosix(value) {
  return value.split(path.sep).join('/');
}

export function assertCaseSlug(slug) {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
    throw new Error('case slug must match ^[a-z0-9][a-z0-9-]{1,62}$');
  }
}

export async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
}

export async function readJson(target) {
  const raw = await fs.readFile(target, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid JSON at ${target}: ${error.message}`);
  }
}

export async function writeJsonAtomic(target, value) {
  await ensureDir(path.dirname(target));
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, target);
}

export async function writeTextAtomic(target, value) {
  await ensureDir(path.dirname(target));
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  const text = value.endsWith('\n') ? value : `${value}\n`;
  await fs.writeFile(temporary, text, 'utf8');
  await fs.rename(temporary, target);
}

export async function loadCase(casePath) {
  const file = path.join(casePath, 'case.json');
  return readJson(file);
}

export async function saveCase(casePath, data) {
  data.updated_at = nowIso();
  await writeJsonAtomic(path.join(casePath, 'case.json'), data);
}

export async function listFilesRecursive(root, options = {}) {
  const { ignore = [] } = options;
  const output = [];
  if (!(await pathExists(root))) return output;

  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = toPosix(path.relative(root, absolute));
      if (ignore.some((pattern) => relative === pattern || relative.startsWith(`${pattern}/`))) continue;
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) output.push(absolute);
    }
  }

  await visit(root);
  return output;
}

export function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableObject(value[key])]),
    );
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableObject(value));
}

export function safeFileName(value) {
  return String(value)
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'item';
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
