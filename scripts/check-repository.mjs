import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { REQUIRED_SKILL_HEADINGS, SKILL_NAMES } from '../src/lib/constants.js';
import { listJurisdictionAdapters } from '../src/lib/jurisdiction.js';
import { listFilesRecursive } from '../src/lib/io.js';
import { scanText } from '../src/lib/privacy.js';
import { validateCaseDirectory } from '../src/lib/validate.js';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const failures = [];

for (const file of await listFilesRecursive(root, { ignore: ['.git', 'node_modules', 'cases', 'build'] })) {
  if (path.extname(file) === '.json') {
    try { JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { failures.push(`${path.relative(root, file)}: invalid JSON: ${error.message}`); }
  }
  if (['.md', '.js', '.mjs', '.json', '.yaml', '.yml', '.csv'].includes(path.extname(file))) {
    const text = await fs.readFile(file, 'utf8');
    for (const match of scanText(text).filter((item) => item.kind === 'secret')) {
      failures.push(`${path.relative(root, file)}: possible secret ${match.label}`);
    }
  }
}

for (const name of SKILL_NAMES) {
  const file = path.join(root, 'skills', name, 'SKILL.md');
  let text;
  try { text = await fs.readFile(file, 'utf8'); }
  catch { failures.push(`missing skill: ${name}`); continue; }
  for (const heading of REQUIRED_SKILL_HEADINGS) {
    if (!text.includes(heading)) failures.push(`skills/${name}/SKILL.md missing heading: ${heading}`);
  }
}

try {
  const adapters = await listJurisdictionAdapters(path.join(root, 'adapters', 'jurisdiction'));
  if (adapters.length < 2) failures.push('jurisdiction adapters: at least two adapters are required to validate the contract');
} catch (error) {
  failures.push(`jurisdiction adapters: ${error.message}`);
}

const example = await validateCaseDirectory(path.join(root, 'examples', 'apartment-night-delivery'));
for (const item of example.findings.filter((finding) => finding.severity === 'error')) {
  failures.push(`example: ${item.code} ${item.path}: ${item.message}`);
}

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join('\n'));
  process.exit(1);
}
console.log('repository checks passed');
