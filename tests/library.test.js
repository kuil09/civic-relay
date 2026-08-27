import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildLibrary, publishCase, validatePublicBundle } from '../src/lib/library.js';
import { scanText } from '../src/lib/privacy.js';

async function tempRoot(t) {
  const root = await fs.mkdtemp('/tmp/civic-relay-library-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function createRedactedCase(root, id = 'night-delivery') {
  const casePath = path.join(root, `${id}-redacted`);
  await fs.mkdir(path.join(casePath, 'build'), { recursive: true });
  const data = {
    schema_version: '0.1',
    case_id: id,
    title: '심야 하역 제도 개선',
    jurisdiction: { country: 'KR', region: null, locality: null },
    original_statement: '[REDACTED_EMAIL]이 제안한 원문',
    problem_definition: '제도와 현장 운영 사이의 공백을 검토한다.',
    desired_change: '권한 주체가 복수 대안을 공동 검토한다.',
    research_questions: ['현행 법적 계층은 무엇인가?', '권리 충돌은 어떻게 평가할 것인가?'],
    claims: [{ claim_id: 'claim-1', text: '사례 고유 사실', source_ids: ['source-1'] }],
    sources: [{ source_id: 'source-1', locator: 'https://example.invalid/' }],
    stakeholders: [
      { stakeholder_id: 's1', name: '특정 집단', roles: ['rights_holder'], interests: ['접근권'], risks: ['권리 침해'] },
    ],
    options: [
      {
        option_id: 'o1', title: '시간 제한 시범', category: 'pilot', mechanism: '한정된 시간과 장소에서 시험한다.',
        legal_change: '명시적 근거 검토', implementer: '특정 기관명', rights_impact: '권리 충돌을 측정한다.',
        cost: '운영 비용', enforcement_difficulty: 'high', reversibility: 'high', metrics: ['충돌 건수'],
        stop_conditions: ['권리 침해 발생'], assumptions: ['검증 가능성'],
      },
    ],
    counterarguments: [
      { counterargument_id: 'c1', argument: '예외가 상시화될 수 있다.', strength: 'strong', source_ids: ['source-1'], response: '종료 조건을 둔다.', residual_risk: '집행 실패' },
    ],
    recipients: [{ recipient_id: 'r1', official_channel: '[REDACTED_EMAIL]', channel_source: 'https://example.invalid/' }],
    approvals: [{ stage: 'document', actor: 'Private Person' }],
    dispatches: [{ dispatch_key: 'private', provider_message_id: 'private' }],
    responses: [{ original_file: 'private' }],
  };
  await fs.writeFile(path.join(casePath, 'case.json'), `${JSON.stringify(data, null, 2)}\n`);
  await fs.writeFile(path.join(casePath, '07-policy-proposal.md'), '# 정책 제안\n\n검토 가능한 공개 요약이다.\n');
  await fs.writeFile(path.join(casePath, 'build', 'one-page-summary.md'), '# 한 페이지 요약\n\n공개 검토용 내용이다.\n');
  await fs.writeFile(path.join(casePath, 'redaction-manifest.json'), `${JSON.stringify({
    source: `/tmp/private/${id}`,
    output: casePath,
    created_at: '2026-08-27T09:00:00.000Z',
    files: [
      { path: 'case.json', copied: false, redactions: { email: 1 } },
      { path: '07-policy-proposal.md', copied: false, redactions: {} },
      { path: 'build/one-page-summary.md', copied: false, redactions: {} },
    ],
  }, null, 2)}\n`);
  return casePath;
}

async function readCoreBundle(bundle) {
  const output = {};
  for (const file of ['public-case.json', 'summary.md', 'policy-patterns.json', 'redaction-manifest.json', 'integrity-manifest.json']) {
    output[file] = await fs.readFile(path.join(bundle, file), 'utf8');
  }
  return output;
}

test('publishing requires a redacted case and strips case-specific records', async (t) => {
  const root = await tempRoot(t);
  const original = path.join(root, 'original');
  await fs.mkdir(original);
  await fs.writeFile(path.join(original, 'case.json'), '{}\n');
  await assert.rejects(() => publishCase(original, path.join(root, 'blocked')), /redaction-manifest/);

  const redacted = await createRedactedCase(root);
  const bundle = path.join(root, 'public', 'night-delivery');
  const result = await publishCase(redacted, bundle);
  assert.equal(result.public_case.dispatchable, false);
  const validation = await validatePublicBundle(bundle);
  assert.equal(validation.valid, true, validation.errors.join('\n'));

  const publicCase = JSON.parse(await fs.readFile(path.join(bundle, 'public-case.json'), 'utf8'));
  const patterns = JSON.parse(await fs.readFile(path.join(bundle, 'policy-patterns.json'), 'utf8'));
  const sanitizedManifest = JSON.parse(await fs.readFile(path.join(bundle, 'redaction-manifest.json'), 'utf8'));
  assert.equal('source' in sanitizedManifest, false);
  assert.equal('output' in sanitizedManifest, false);
  for (const prohibited of ['claims', 'sources', 'recipients', 'dispatches', 'responses', 'approvals', 'original_statement']) {
    assert.equal(prohibited in publicCase, false);
    assert.equal(prohibited in patterns, false);
  }
  assert.equal(JSON.stringify(patterns).includes('특정 기관명'), false);
  assert.equal(patterns.reusable_scope, 'design_patterns_only');
});

test('public bundles contain no sensitive data or local absolute paths', async (t) => {
  const root = await tempRoot(t);
  const redacted = await createRedactedCase(root);
  const bundle = path.join(root, 'public', 'bundle');
  await publishCase(redacted, bundle);
  for (const entry of await fs.readdir(bundle)) {
    const text = await fs.readFile(path.join(bundle, entry), 'utf8');
    assert.deepEqual(scanText(text), []);
    assert.equal(text.includes('/tmp/private/'), false);
    assert.equal(text.includes(root), false);
  }
});

test('publication is deterministic for the same redacted snapshot', async (t) => {
  const root = await tempRoot(t);
  const redacted = await createRedactedCase(root);
  const first = path.join(root, 'public-a', 'bundle');
  const second = path.join(root, 'public-b', 'bundle');
  await publishCase(redacted, first);
  await publishCase(redacted, second);
  assert.deepEqual(await readCoreBundle(first), await readCoreBundle(second));
});

test('library index contains only valid bundles and remains deterministic', async (t) => {
  const root = await tempRoot(t);
  const publicRoot = path.join(root, 'public');
  await publishCase(await createRedactedCase(root, 'case-b'), path.join(publicRoot, 'b'));
  await publishCase(await createRedactedCase(root, 'case-a'), path.join(publicRoot, 'a'));
  const first = await buildLibrary(publicRoot);
  const firstText = await fs.readFile(path.join(publicRoot, 'library.json'), 'utf8');
  const second = await buildLibrary(publicRoot);
  const secondText = await fs.readFile(path.join(publicRoot, 'library.json'), 'utf8');
  assert.deepEqual(first, second);
  assert.equal(firstText, secondText);
  assert.equal(first.count, 2);
  assert.deepEqual(first.entries.map((entry) => entry.bundle), ['a', 'b']);
  assert.ok(first.entries.every((entry) => entry.dispatchable === false));
  assert.equal(firstText.includes(root), false);
});
