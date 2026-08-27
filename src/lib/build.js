import { promises as fs } from 'node:fs';
import path from 'node:path';
import { computeDocumentHash, hashFile } from './hash.js';
import { ensureDir, loadCase, nowIso, pathExists, saveCase, writeJsonAtomic, writeTextAtomic } from './io.js';
import { validateCaseDirectory } from './validate.js';

function bullet(values, empty = '- 미정') {
  return values?.length ? values.map((value) => `- ${value}`).join('\n') : empty;
}

function selectedCategories(recipients) {
  return [...new Set((recipients || []).filter((item) => item.selected).map((item) => item.organization))];
}

export async function buildCase(casePath) {
  const data = await loadCase(casePath);
  const buildPath = path.join(casePath, 'build');
  await ensureDir(buildPath);

  const onePage = `# ${data.title} — 한 페이지 요약

## 문제 한 문장

${data.problem_definition || '문제 정의가 아직 승인되지 않았다.'}

## 왜 검토해야 하는가

${data.desired_change || '사용자가 원하는 변화와 검토 범위를 추가해야 한다.'}

## 주요 이해관계자와 비용

${bullet((data.stakeholders || []).map((item) => `${item.name}: ${(item.interests || []).join('; ')}`))}

## 현행 제도의 빈틈

${bullet((data.legal_layers || []).map((item) => `${item.instrument}: ${item.current_rule}`))}

## 검토할 대안

${bullet((data.options || []).map((item) => `${item.title} — ${item.mechanism}`))}

## 요청하는 조치

${bullet((data.authorities || []).map((item) => `${item.organization}: ${item.action} — ${item.reason}`))}

## 공동 논의 대상

${bullet((data.authorities || []).filter((item) => item.jurisdiction_type !== 'reference').map((item) => item.organization))}
`;
  await writeTextAtomic(path.join(buildPath, 'one-page-summary.md'), onePage);

  const evidencePath = path.join(casePath, '02-evidence-dossier.md');
  const evidence = (await pathExists(evidencePath)) ? await fs.readFile(evidencePath, 'utf8') : '# Evidence Dossier\n\n미작성\n';
  await writeTextAtomic(path.join(buildPath, 'evidence-appendix.md'), `# ${data.title} — 근거 부록\n\n${evidence.replace(/^# .*\n/, '')}`);

  const organizations = selectedCategories(data.recipients);
  const distribution = `# 배포 고지

이 정책 검토 패키지는 다음 기관 또는 의원실 범주에 동일한 핵심 문서로 개별 전달하도록 준비되었다.

${bullet(organizations)}

주소는 수신자 간에 공유하지 않는다. 실제 발송 명세에 없는 기관을 전달 대상으로 표시해서는 안 된다.
`;
  await writeTextAtomic(path.join(buildPath, 'distribution-notice.md'), distribution);

  const validation = await validateCaseDirectory(casePath, { scanSensitive: true });
  const findingLines = validation.findings.length
    ? validation.findings.map((item) => `- **${item.severity.toUpperCase()} ${item.code}** — \`${item.path}\`: ${item.message}`).join('\n')
    : '- 구조 검증에서 발견된 항목 없음';
  const approvalLines = (data.approvals || []).length
    ? data.approvals.map((item) => `- ${item.stage}: ${item.actor}, ${item.approved_at}, \`${item.content_hash.slice(0, 12)}…\``).join('\n')
    : '- 승인 없음';
  const review = `# ${data.title} — Review

## 원문

${data.original_statement}

## 현재 상태

- 사례 상태: \`${data.status}\`
- 선택 수신자: ${(data.recipients || []).filter((item) => item.selected).length}
- 사실 주장: ${(data.claims || []).filter((item) => item.type === 'fact').length}
- 대안: ${(data.options || []).length}
- 강한 반론: ${(data.counterarguments || []).filter((item) => item.strength === 'strong').length}

## 검증 결과

${findingLines}

## 승인 이력

${approvalLines}

## 발송 전 확인

- [ ] 현직·조직·연락 경로가 24시간 이내 공식 출처로 재검증되었다.
- [ ] 제목, 본문, 첨부 문서, 공동 전달 고지가 실제 발송 대상과 일치한다.
- [ ] 사용자가 발송 단계를 직접 승인했다.
- [ ] 동일 사례·문서·수신자의 성공 발송 기록이 없다.
`;
  await writeTextAtomic(path.join(buildPath, 'review.md'), review);

  const packageFiles = [
    'one-page-summary.md',
    'evidence-appendix.md',
    'distribution-notice.md',
    'review.md',
  ];
  const files = [];
  for (const file of packageFiles) {
    const absolute = path.join(buildPath, file);
    files.push({ path: `build/${file}`, hash: await hashFile(absolute) });
  }
  const proposal = path.join(casePath, '07-policy-proposal.md');
  if (await pathExists(proposal)) files.push({ path: '07-policy-proposal.md', hash: await hashFile(proposal) });
  const documentHash = await computeDocumentHash(casePath);
  const manifest = {
    schema_version: '0.1',
    case_id: data.case_id,
    built_at: nowIso(),
    document_hash: documentHash,
    files,
    validation: {
      valid: validation.valid,
      errors: validation.findings.filter((item) => item.severity === 'error').length,
      warnings: validation.findings.filter((item) => item.severity === 'warning').length,
    },
  };
  await writeJsonAtomic(path.join(buildPath, 'package-manifest.json'), manifest);

  data.artifacts = (data.artifacts || []).filter((item) => !item.path.startsWith('build/'));
  for (const file of [...files, { path: 'build/package-manifest.json', hash: await hashFile(path.join(buildPath, 'package-manifest.json')) }]) {
    data.artifacts.push({ path: file.path, kind: 'build', hash: file.hash, generated_at: manifest.built_at });
  }
  await saveCase(casePath, data);
  return manifest;
}
