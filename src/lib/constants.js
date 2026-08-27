export const SCHEMA_VERSION = '0.1';

export const CASE_STATUS = [
  'intake',
  'research',
  'draft',
  'review',
  'approved',
  'dispatched',
  'follow_up',
  'closed',
];

export const STATUS_RANK = Object.fromEntries(CASE_STATUS.map((status, index) => [status, index]));

export const APPROVAL_STAGES = [
  'problem',
  'evidence',
  'policy',
  'recipients',
  'document',
  'dispatch',
];

export const CASE_FILES = [
  '00-intake.md',
  '01-issue-brief.md',
  '02-evidence-dossier.md',
  '03-law-and-authority-map.md',
  '04-stakeholder-map.md',
  '05-options-memo.md',
  '06-counterarguments.md',
  '07-policy-proposal.md',
  '08-recipient-matrix.csv',
  '09-cover-emails',
  '10-dispatch-manifest.json',
  '11-responses',
  '12-follow-up.md',
  'case.json',
];

export const STAGE_SCOPES = {
  problem: {
    fields: ['case_id', 'title', 'jurisdiction', 'original_statement', 'problem_definition', 'desired_change'],
    files: ['00-intake.md', '01-issue-brief.md'],
  },
  evidence: {
    fields: ['claims', 'sources'],
    files: ['02-evidence-dossier.md'],
  },
  policy: {
    fields: ['legal_layers', 'authorities', 'stakeholders', 'options', 'counterarguments'],
    files: [
      '03-law-and-authority-map.md',
      '04-stakeholder-map.md',
      '05-options-memo.md',
      '06-counterarguments.md',
      '07-policy-proposal.md',
    ],
  },
  recipients: {
    fields: ['recipients'],
    files: ['08-recipient-matrix.csv'],
  },
  document: {
    fields: ['title', 'problem_definition', 'desired_change', 'options', 'counterarguments', 'recipients'],
    files: [
      '07-policy-proposal.md',
      'build/one-page-summary.md',
      'build/evidence-appendix.md',
    ],
  },
  dispatch: {
    fields: ['recipients'],
    files: ['09-cover-emails', 'build/distribution-notice.md'],
  },
};

export const RESPONSE_CLASSIFICATIONS = [
  'acknowledgement',
  'not_responsible',
  'referred',
  'request_for_information',
  'opposed',
  'review_promised',
  'meeting_proposed',
  'no_response',
  'uncertain',
  'other',
];

export const SKILL_NAMES = [
  'issue-intake',
  'problem-framing',
  'evidence-research',
  'law-policy-mapping',
  'authority-routing',
  'committee-routing',
  'stakeholder-analysis',
  'option-design',
  'counterargument-redteam',
  'proposal-writing',
  'recipient-resolution',
  'delivery-packaging',
  'mail-dispatch',
  'response-tracking',
];

export const REQUIRED_SKILL_HEADINGS = [
  '## 목적',
  '## 실행 조건',
  '## 입력',
  '## 절차',
  '## 출력',
  '## `case.json` 변경 범위',
  '## 자체 검증',
  '## 실패·불확실성 처리',
  '## 금지 행동',
  '## 다음 단계',
  '## PRD 추적',
];
