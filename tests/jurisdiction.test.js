import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_JURISDICTION_ROOT,
  listJurisdictionAdapters,
  loadJurisdictionAdapter,
  validateJurisdictionAdapter,
} from '../src/lib/jurisdiction.js';

async function temporaryAdapterRoot(t) {
  const root = await fs.mkdtemp('/tmp/civic-relay-jurisdiction-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('KR and US-FED adapters load through the same contract', async () => {
  const listed = await listJurisdictionAdapters();
  assert.deepEqual(listed.map((item) => item.id), ['KR', 'US-FED']);
  for (const id of ['KR', 'US-FED']) {
    const adapter = await loadJurisdictionAdapter(id);
    const result = validateJurisdictionAdapter(adapter, { expectedId: id });
    assert.equal(result.valid, true, result.errors.join('\n'));
    assert.ok(adapter.legal_layers.length >= 5);
    assert.ok(adapter.official_sources.every((source) => source.base_url.startsWith('https://')));
  }
  assert.equal(path.resolve(DEFAULT_JURISDICTION_ROOT).endsWith(path.join('adapters', 'jurisdiction')), true);
});

test('adapter validation rejects current office holders and direct contact data', async () => {
  const adapter = structuredClone(await loadJurisdictionAdapter('KR'));
  adapter.current_holders = [{ person_name: 'Example Person', email: 'person@example.test' }];
  const result = validateJurisdictionAdapter(adapter);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((item) => item.includes('current_holders')));
  assert.ok(result.errors.some((item) => item.includes('direct personal contact')));
});

test('unknown adapter IDs fail instead of falling back to KR', async () => {
  await assert.rejects(() => loadJurisdictionAdapter('UNKNOWN'), /unknown jurisdiction adapter/);
  await assert.rejects(() => loadJurisdictionAdapter('kr'), /invalid jurisdiction adapter id/);
});

test('duplicate adapter IDs and filename mismatches fail listing', async (t) => {
  const root = await temporaryAdapterRoot(t);
  const adapter = await loadJurisdictionAdapter('KR');
  await fs.writeFile(path.join(root, 'KR.json'), `${JSON.stringify(adapter, null, 2)}\n`);
  await fs.writeFile(path.join(root, 'KR-COPY.json'), `${JSON.stringify(adapter, null, 2)}\n`);
  await assert.rejects(() => listJurisdictionAdapters(root), /expected KR-COPY/);
});
