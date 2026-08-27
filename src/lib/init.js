import path from 'node:path';
import { SCHEMA_VERSION } from './constants.js';
import { assertCaseSlug, ensureDir, nowIso, pathExists, writeJsonAtomic, writeTextAtomic } from './io.js';

const EMPTY_DOCUMENTS = {
  '01-issue-brief.md': '# Issue Brief\n\n## 문제 현상\n\n## 원인 가설\n\n## 피해·비용·권리 영향\n\n## 관할과 범위\n\n## 사용자가 원하는 변화\n\n## 조사 질문\n',
  '02-evidence-dossier.md': '# Evidence Dossier\n\n## 확인된 사실\n\n## 사용자 관찰\n\n## 충돌하거나 미확인인 주장\n\n## 공식 자료\n\n## 추가 조사\n',
  '03-law-and-authority-map.md': '# Law and Authority Map\n\n## 현행 규정\n\n## 법·제도 계층\n\n## 권한 주체\n\n## 공동 소관\n\n## 법적 불확실성\n',
  '04-stakeholder-map.md': '# Stakeholder Map\n\n## 직접 수혜자\n\n## 직접 부담자\n\n## 권리 침해 가능 집단\n\n## 비용·집행·운영 주체\n',
  '05-options-memo.md': '# Policy Options Memo\n\n## 비교 기준\n\n## 현행 유지안\n\n## 대안 1\n\n## 대안 2\n\n## 대안 3\n\n## 시범사업과 종료 조건\n',
  '06-counterarguments.md': '# Counterarguments\n\n## 강한 반론 1\n\n## 강한 반론 2\n\n## 강한 반론 3\n\n## 악용·확대·집행 실패\n\n## 잔여 위험\n',
  '07-policy-proposal.md': '# Policy Review Request\n\n## 한 문장 요약\n\n## 제안 목적\n\n## 현장 문제\n\n## 확인된 사실과 근거\n\n## 현행 제도와 한계\n\n## 권한 구조\n\n## 이해관계자와 권리 충돌\n\n## 정책 대안 비교\n\n## 검토 요청안\n\n## 악용 방지와 집행 조건\n\n## 요청하는 회신·후속 절차\n\n## 출처\n',
  '12-follow-up.md': '# Follow-up\n\n## 현재 상태\n\n## 추가 조사\n\n## 회신에서 확인된 사항\n\n## 다음 승인·전달 작업\n',
};

export async function initCase(options) {
  const { slug, root = 'cases', title = slug, statement = '<사용자 원문을 입력하세요>' } = options;
  assertCaseSlug(slug);
  const casePath = path.resolve(root, slug);
  if (await pathExists(casePath)) throw new Error(`case already exists: ${casePath}`);
  await ensureDir(casePath);
  await ensureDir(path.join(casePath, '09-cover-emails'));
  await ensureDir(path.join(casePath, '11-responses'));

  const created = nowIso();
  const data = {
    schema_version: SCHEMA_VERSION,
    case_id: slug,
    title,
    status: 'intake',
    jurisdiction: { country: 'KR', region: null, locality: null },
    original_statement: statement,
    problem_definition: '',
    desired_change: '',
    claims: [],
    sources: [],
    legal_layers: [],
    authorities: [],
    stakeholders: [],
    options: [],
    counterarguments: [],
    recipients: [],
    artifacts: [],
    approvals: [],
    dispatches: [],
    responses: [],
    created_at: created,
    updated_at: created,
    privacy: { contains_personal_data: false, public_export_allowed: false, notes: '' },
  };

  await writeTextAtomic(path.join(casePath, '00-intake.md'), `# Intake\n\n## 사용자 원문\n\n${statement}\n\n## 원하는 결과\n\n조사 / 정책 제안 / 전달 패키지 / 발송 중 선택\n`);
  for (const [file, content] of Object.entries(EMPTY_DOCUMENTS)) {
    await writeTextAtomic(path.join(casePath, file), content);
  }
  await writeTextAtomic(
    path.join(casePath, '08-recipient-matrix.csv'),
    'recipient_id,organization,role,jurisdiction_type,reason,expected_action,channel_type,official_channel,channel_source,verified_at,verification_status,selected,status\n',
  );
  await writeJsonAtomic(path.join(casePath, '10-dispatch-manifest.json'), {
    schema_version: SCHEMA_VERSION,
    case_id: slug,
    mode: 'draft',
    document_hash: null,
    distribution_categories: [],
    dispatches: [],
  });
  await writeJsonAtomic(path.join(casePath, 'case.json'), data);
  return casePath;
}
