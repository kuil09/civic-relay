import { promises as fs } from 'node:fs';
import path from 'node:path';
import { APPROVAL_STAGES, CASE_STATUS, STATUS_RANK } from './constants.js';
import { approvalState } from './approval.js';
import { loadCase, pathExists } from './io.js';
import { verifyRecipients } from './recipients.js';
import { scanText } from './privacy.js';

function finding(severity, code, target, message, requirement = null) {
  return { severity, code, path: target, message, requirement };
}

function isNonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function checkUnique(items, key, target, findings) {
  const seen = new Set();
  for (const item of items || []) {
    const value = item?.[key];
    if (!isNonEmpty(value)) {
      findings.push(finding('error', 'missing_id', target, `missing ${key}`));
      continue;
    }
    if (seen.has(value)) findings.push(finding('error', 'duplicate_id', `${target}/${value}`, `${key} is duplicated`));
    seen.add(value);
  }
  return seen;
}

function stageAtLeast(data, status) {
  return STATUS_RANK[data.status] >= STATUS_RANK[status];
}

export function validateCaseObject(data) {
  const findings = [];
  const required = [
    'schema_version', 'case_id', 'title', 'status', 'jurisdiction', 'original_statement',
    'problem_definition', 'desired_change', 'claims', 'sources', 'legal_layers', 'authorities',
    'stakeholders', 'options', 'counterarguments', 'recipients', 'artifacts', 'approvals',
    'dispatches', 'responses', 'created_at', 'updated_at',
  ];
  for (const key of required) {
    if (!(key in data)) findings.push(finding('error', 'missing_field', `case.json#/${key}`, `required field ${key} is missing`));
  }
  if (data.schema_version !== '0.1') findings.push(finding('error', 'schema_version', 'case.json#/schema_version', 'schema_version must be 0.1'));
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(data.case_id || '')) findings.push(finding('error', 'case_id', 'case.json#/case_id', 'invalid case_id'));
  if (!CASE_STATUS.includes(data.status)) findings.push(finding('error', 'status', 'case.json#/status', 'invalid status'));
  if (!isNonEmpty(data.title)) findings.push(finding('error', 'title', 'case.json#/title', 'title is required'));
  if (!isNonEmpty(data.original_statement)) findings.push(finding('error', 'original_statement', 'case.json#/original_statement', 'original statement must be preserved', 'AC-01'));
  if (!Array.isArray(data.claims)) findings.push(finding('error', 'claims_type', 'case.json#/claims', 'claims must be an array'));

  const sourceIds = checkUnique(data.sources, 'source_id', 'case.json#/sources', findings);
  const claimIds = checkUnique(data.claims, 'claim_id', 'case.json#/claims', findings);
  checkUnique(data.legal_layers, 'layer_id', 'case.json#/legal_layers', findings);
  checkUnique(data.authorities, 'authority_id', 'case.json#/authorities', findings);
  checkUnique(data.stakeholders, 'stakeholder_id', 'case.json#/stakeholders', findings);
  checkUnique(data.options, 'option_id', 'case.json#/options', findings);
  checkUnique(data.counterarguments, 'counterargument_id', 'case.json#/counterarguments', findings);
  checkUnique(data.recipients, 'recipient_id', 'case.json#/recipients', findings);
  checkUnique(data.approvals, 'approval_id', 'case.json#/approvals', findings);
  checkUnique(data.dispatches, 'dispatch_id', 'case.json#/dispatches', findings);
  checkUnique(data.responses, 'response_id', 'case.json#/responses', findings);

  for (const source of data.sources || []) {
    if (!isNonEmpty(source.title) || !isNonEmpty(source.publisher) || !isNonEmpty(source.locator)) {
      findings.push(finding('error', 'source_incomplete', `case.json#/sources/${source.source_id || '?'}`, 'source requires title, publisher, and locator', 'CR-102'));
    }
    if (!source.checked_at) findings.push(finding('error', 'source_checked_at', `case.json#/sources/${source.source_id || '?'}`, 'source requires checked_at', 'CR-102'));
    for (const claimId of [...(source.supports || []), ...(source.contradicts || [])]) {
      if (!claimIds.has(claimId)) findings.push(finding('error', 'source_claim_reference', `case.json#/sources/${source.source_id}`, `unknown claim reference ${claimId}`));
    }
  }

  for (const claim of data.claims || []) {
    const target = `case.json#/claims/${claim.claim_id || '?'}`;
    if (!['observation', 'fact', 'inference', 'value_judgment', 'proposal'].includes(claim.type)) {
      findings.push(finding('error', 'claim_type', target, 'invalid claim type', 'CR-003'));
    }
    if (claim.type === 'observation' && claim.origin !== 'user_observation') {
      findings.push(finding('error', 'observation_origin', target, 'observation must be marked user_observation', 'AC-03'));
    }
    if (claim.type === 'fact' && !(claim.source_ids || []).length) {
      findings.push(finding('error', 'fact_without_source', target, 'fact requires at least one source', 'AC-03'));
    }
    for (const sourceId of [...(claim.source_ids || []), ...(claim.contradicting_source_ids || [])]) {
      if (!sourceIds.has(sourceId)) findings.push(finding('error', 'claim_source_reference', target, `unknown source reference ${sourceId}`));
    }
    if (claim.use_in_proposal && claim.type !== 'observation' && !(claim.source_ids || []).length && claim.type !== 'value_judgment' && claim.type !== 'proposal') {
      findings.push(finding('error', 'unsupported_proposal_claim', target, 'claim used in proposal lacks evidence or user-observation status', 'AC-03'));
    }
  }

  for (const layer of data.legal_layers || []) {
    if (!isNonEmpty(layer.instrument) || !isNonEmpty(layer.current_rule) || !isNonEmpty(layer.change_path) || !isNonEmpty(layer.decision_maker)) {
      findings.push(finding('error', 'legal_layer_incomplete', `case.json#/legal_layers/${layer.layer_id || '?'}`, 'legal layer lacks rule, change path, or decision maker', 'AC-02'));
    }
    for (const sourceId of layer.source_ids || []) {
      if (!sourceIds.has(sourceId)) findings.push(finding('error', 'legal_source_reference', `case.json#/legal_layers/${layer.layer_id}`, `unknown source reference ${sourceId}`));
    }
  }

  for (const authority of data.authorities || []) {
    if (!isNonEmpty(authority.organization) || !isNonEmpty(authority.reason)) {
      findings.push(finding('error', 'authority_incomplete', `case.json#/authorities/${authority.authority_id || '?'}`, 'authority requires organization and reason', 'AC-02'));
    }
  }

  if (stageAtLeast(data, 'draft')) {
    if ((data.legal_layers || []).length === 0) findings.push(finding('error', 'missing_legal_layers', 'case.json#/legal_layers', 'draft requires legal-layer analysis', 'AC-02'));
    if ((data.authorities || []).length === 0) findings.push(finding('error', 'missing_authorities', 'case.json#/authorities', 'draft requires authority mapping', 'AC-02'));
    if ((data.options || []).length < 4) findings.push(finding('error', 'insufficient_options', 'case.json#/options', 'draft requires status quo plus at least three substantive options', 'AC-07'));
    if (!(data.options || []).some((option) => option.category === 'status_quo')) findings.push(finding('error', 'missing_status_quo', 'case.json#/options', 'options must include a status quo baseline', 'AC-07'));
    if ((data.counterarguments || []).filter((item) => item.strength === 'strong').length < 3) {
      findings.push(finding('error', 'insufficient_counterarguments', 'case.json#/counterarguments', 'draft requires at least three strong counterarguments', 'AC-06'));
    }
  }

  for (const recipient of data.recipients || []) {
    const target = `case.json#/recipients/${recipient.recipient_id || '?'}`;
    if (!isNonEmpty(recipient.reason)) findings.push(finding('error', 'recipient_reason', target, 'recipient selection requires a reason', 'AC-04'));
    if (!isNonEmpty(recipient.expected_action)) findings.push(finding('error', 'recipient_expected_action', target, 'recipient requires an expected action', 'AC-04'));
    if (recipient.selected && !recipient.channel_source) findings.push(finding('error', 'recipient_channel_source', target, 'selected recipient requires official-channel source', 'AC-04'));
  }

  const dispatchKeys = new Set();
  for (const dispatch of data.dispatches || []) {
    if (dispatchKeys.has(dispatch.dispatch_key) && ['sent', 'drafted', 'queued'].includes(dispatch.status)) {
      findings.push(finding('error', 'duplicate_dispatch', `case.json#/dispatches/${dispatch.dispatch_id || '?'}`, 'duplicate dispatch key', 'AC-11'));
    }
    dispatchKeys.add(dispatch.dispatch_key);
  }

  for (const response of data.responses || []) {
    if (response.classification === 'no_response' && response.original_file) {
      findings.push(finding('warning', 'no_response_original', `case.json#/responses/${response.response_id}`, 'no_response normally should not contain a received message'));
    }
  }

  return findings;
}

async function requiredFilesForStatus(casePath, data, findings) {
  const requirements = [
    ['intake', ['00-intake.md', 'case.json']],
    ['research', ['01-issue-brief.md', '02-evidence-dossier.md']],
    ['draft', ['03-law-and-authority-map.md', '04-stakeholder-map.md', '05-options-memo.md', '06-counterarguments.md', '07-policy-proposal.md']],
    ['review', ['08-recipient-matrix.csv', '09-cover-emails']],
  ];
  for (const [status, files] of requirements) {
    if (!stageAtLeast(data, status)) continue;
    for (const file of files) {
      if (!(await pathExists(path.join(casePath, file)))) findings.push(finding('error', 'missing_artifact', file, `${status} status requires ${file}`));
    }
  }
}

export async function validateCaseDirectory(casePath, options = {}) {
  const { forSend = false, maxAgeHours = 24, scanSensitive = true } = options;
  const findings = [];
  let data;
  try {
    data = await loadCase(casePath);
  } catch (error) {
    return { valid: false, findings: [finding('error', 'case_json', 'case.json', error.message)], data: null };
  }
  findings.push(...validateCaseObject(data));
  await requiredFilesForStatus(casePath, data, findings);

  const intakeFile = path.join(casePath, '00-intake.md');
  if (await pathExists(intakeFile)) {
    const intake = await fs.readFile(intakeFile, 'utf8');
    if (!intake.includes(data.original_statement)) findings.push(finding('error', 'original_not_preserved', '00-intake.md', '00-intake.md does not contain original_statement verbatim', 'AC-01'));
  }

  for (const approval of data.approvals || []) {
    if (!APPROVAL_STAGES.includes(approval.stage)) continue;
    const latest = [...data.approvals].filter((item) => item.stage === approval.stage).sort((a, b) => String(b.approved_at).localeCompare(String(a.approved_at)))[0];
    if (latest?.approval_id !== approval.approval_id) continue;
    const state = await approvalState(casePath, approval.stage, data);
    if (!state.valid) findings.push(finding('warning', 'approval_stale', `case.json#/approvals/${approval.approval_id}`, `${approval.stage} approval is ${state.reason}`, 'CR-705'));
  }

  if (stageAtLeast(data, 'approved')) {
    for (const stage of APPROVAL_STAGES.slice(0, 5)) {
      const state = await approvalState(casePath, stage, data);
      if (!state.valid) findings.push(finding('error', 'required_approval', `case.json#/approvals`, `${stage} approval is ${state.reason}`, 'AC-08'));
    }
  }

  if (forSend || stageAtLeast(data, 'dispatched')) {
    const verification = verifyRecipients(data, { maxAgeHours, selectedOnly: true });
    if (verification.selectedCount === 0) findings.push(finding('error', 'no_selected_recipients', 'case.json#/recipients', 'send requires at least one selected recipient'));
    for (const result of verification.results.filter((item) => !item.valid)) {
      findings.push(finding('error', 'recipient_currentness', `case.json#/recipients/${result.recipient_id}`, `recipient verification failed: ${result.issues.join(', ')}`, 'AC-05'));
    }
    const dispatchApproval = await approvalState(casePath, 'dispatch', data);
    if (!dispatchApproval.valid) findings.push(finding('error', 'dispatch_approval', 'case.json#/approvals', `dispatch approval is ${dispatchApproval.reason}`, 'AC-08'));
  }

  if (scanSensitive) {
    for (const file of ['00-intake.md', 'case.json']) {
      const absolute = path.join(casePath, file);
      if (!(await pathExists(absolute))) continue;
      const text = await fs.readFile(absolute, 'utf8');
      for (const match of scanText(text).filter((item) => item.kind === 'secret')) {
        findings.push(finding('error', 'secret_detected', file, `possible secret detected: ${match.label}`, 'PRD 19.2'));
      }
    }
  }

  const valid = !findings.some((item) => item.severity === 'error');
  return { valid, findings, data };
}
