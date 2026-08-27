import path from 'node:path';
import { APPROVAL_STAGES } from './constants.js';
import { approvalState } from './approval.js';
import { loadCase, pathExists } from './io.js';
import { verifyRecipients } from './recipients.js';
import { validateCaseDirectory } from './validate.js';

export const READINESS_STAGES = ['case', 'send', 'publication'];

function finding(code, target, message, requirement = null) {
  return { code, path: target, message, requirement };
}

function isNonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function commonReadinessFindings(data) {
  const findings = [];
  const claims = Array.isArray(data.claims) ? data.claims : [];
  const sources = Array.isArray(data.sources) ? data.sources : [];
  const legalLayers = Array.isArray(data.legal_layers) ? data.legal_layers : [];
  const authorities = Array.isArray(data.authorities) ? data.authorities : [];
  const stakeholders = Array.isArray(data.stakeholders) ? data.stakeholders : [];
  const options = Array.isArray(data.options) ? data.options : [];
  const counterarguments = Array.isArray(data.counterarguments) ? data.counterarguments : [];
  const alternatives = options.filter((option) => option?.category !== 'status_quo');
  const strongCounterarguments = counterarguments.filter((item) => item?.strength === 'strong');

  if (!isNonEmpty(data.problem_definition)) {
    findings.push(finding('missing_problem_definition', 'case.json#/problem_definition', 'case readiness requires a substantive problem definition', 'PRD 7.1'));
  }
  if (!isNonEmpty(data.desired_change)) {
    findings.push(finding('missing_desired_change', 'case.json#/desired_change', 'case readiness requires the requested level of change', 'PRD 7.1'));
  }
  if (claims.length === 0) {
    findings.push(finding('missing_claims', 'case.json#/claims', 'case readiness requires at least one classified claim', 'AC-03'));
  } else if (!claims.some((claim) => isNonEmpty(claim?.text))) {
    findings.push(finding('empty_claims', 'case.json#/claims', 'case readiness requires at least one claim with substantive text', 'AC-03'));
  }
  if (sources.length === 0) {
    findings.push(finding('missing_sources', 'case.json#/sources', 'case readiness requires at least one recorded source', 'CR-102'));
  }
  if (legalLayers.length === 0) {
    findings.push(finding('missing_legal_layers', 'case.json#/legal_layers', 'case readiness requires legal-layer analysis', 'AC-02'));
  }
  if (authorities.length === 0) {
    findings.push(finding('missing_authorities', 'case.json#/authorities', 'case readiness requires authority mapping', 'AC-02'));
  }
  if (stakeholders.length === 0) {
    findings.push(finding('missing_stakeholders', 'case.json#/stakeholders', 'case readiness requires at least one affected or responsible stakeholder', 'PRD 7.4'));
  } else if (!stakeholders.some((item) => (item?.roles || []).length && ((item?.interests || []).length || (item?.risks || []).length))) {
    findings.push(finding('empty_stakeholder_patterns', 'case.json#/stakeholders', 'case readiness requires a reusable stakeholder role with an interest or risk', 'PRD 7.4'));
  }
  if (!options.some((option) => option?.category === 'status_quo')) {
    findings.push(finding('missing_status_quo', 'case.json#/options', 'case readiness requires a status quo baseline', 'AC-07'));
  }
  if (alternatives.length < 3) {
    findings.push(finding('insufficient_alternatives', 'case.json#/options', `case readiness requires at least three substantive alternatives in addition to the status quo; found ${alternatives.length}`, 'AC-07'));
  }
  for (const [index, option] of options.entries()) {
    if (!isNonEmpty(option?.title) || !isNonEmpty(option?.mechanism)) {
      findings.push(finding('empty_policy_option', `case.json#/options/${option?.option_id || index}`, 'case readiness requires every policy option to have a substantive title and mechanism', 'AC-07'));
    }
  }
  if (strongCounterarguments.length < 3) {
    findings.push(finding('insufficient_strong_counterarguments', 'case.json#/counterarguments', `case readiness requires at least three strong counterarguments; found ${strongCounterarguments.length}`, 'AC-06'));
  }
  for (const [index, item] of strongCounterarguments.entries()) {
    if (!isNonEmpty(item?.argument) || !isNonEmpty(item?.response) || !isNonEmpty(item?.residual_risk)) {
      findings.push(finding('empty_strong_counterargument', `case.json#/counterarguments/${item?.counterargument_id || index}`, 'case readiness requires every strong counterargument to include an argument, response, and residual risk', 'AC-06'));
    }
  }
  return findings;
}

function publicationReadinessFindings(data) {
  const findings = [];
  if (data.privacy?.public_export_allowed !== true) {
    findings.push(finding('public_export_not_allowed', 'case.json#/privacy/public_export_allowed', 'publication readiness requires explicit public export permission', 'PRD 19.2'));
  }
  return findings;
}

function sendDataReadinessFindings(data, options = {}) {
  const { maxAgeHours = 24, now = new Date() } = options;
  const findings = [];
  const verification = verifyRecipients(data, { selectedOnly: true, maxAgeHours, now });
  if (verification.selectedCount === 0) {
    findings.push(finding('no_selected_recipients', 'case.json#/recipients', 'send readiness requires at least one selected recipient', 'AC-04'));
  }
  for (const result of verification.results.filter((item) => !item.valid)) {
    findings.push(finding('recipient_not_current', `case.json#/recipients/${result.recipient_id}`, `send readiness requires a current official recipient: ${result.issues.join(', ')}`, 'AC-05'));
  }
  for (const stage of APPROVAL_STAGES) {
    if (!(data.approvals || []).some((approval) => approval.stage === stage)) {
      findings.push(finding('missing_approval', 'case.json#/approvals', `send readiness requires the ${stage} approval`, 'AC-08'));
    }
  }
  return findings;
}

export function assessCaseReadiness(data, options = {}) {
  const { stage = 'case', maxAgeHours = 24, now = new Date() } = options;
  if (!READINESS_STAGES.includes(stage)) throw new Error(`invalid readiness stage: ${stage}`);
  const findings = commonReadinessFindings(data || {});
  if (stage === 'send') findings.push(...sendDataReadinessFindings(data || {}, { maxAgeHours, now }));
  if (stage === 'publication') findings.push(...publicationReadinessFindings(data || {}));
  return {
    schema_version: '1.0',
    contract: 'semantic_readiness',
    stage,
    ready: findings.length === 0,
    findings,
  };
}

function structuralFinding(item) {
  return finding(`structural_${item.code}`, item.path, item.message, item.requirement);
}

function uniqueFindings(findings) {
  const seen = new Set();
  return findings.filter((item) => {
    const key = `${item.code}\0${item.path}\0${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function assessCaseDirectoryReadiness(casePath, options = {}) {
  const { stage = 'case', maxAgeHours = 24, now = new Date() } = options;
  if (!READINESS_STAGES.includes(stage)) throw new Error(`invalid readiness stage: ${stage}`);

  const structural = await validateCaseDirectory(casePath, { scanSensitive: true });
  if (!structural.data) {
    return {
      schema_version: '1.0',
      contract: 'semantic_readiness',
      stage,
      ready: false,
      structural_valid: false,
      findings: structural.findings.map(structuralFinding),
    };
  }

  const data = await loadCase(casePath);
  const semantic = assessCaseReadiness(data, { stage, maxAgeHours, now });
  const findings = [
    ...structural.findings.filter((item) => item.severity === 'error').map(structuralFinding),
    ...semantic.findings,
  ];

  if (stage === 'publication' && !(await pathExists(path.join(casePath, 'redaction-manifest.json')))) {
    findings.push(finding('missing_redaction_manifest', 'redaction-manifest.json', 'publication readiness requires a reviewed redaction manifest', 'Phase 4.2'));
  }

  if (stage === 'send') {
    for (const approvalStage of APPROVAL_STAGES) {
      try {
        const state = await approvalState(casePath, approvalStage, data);
        if (!state.valid) {
          findings.push(finding('approval_not_current', 'case.json#/approvals', `send readiness requires a current ${approvalStage} approval: ${state.reason}`, 'AC-08'));
        }
      } catch (error) {
        findings.push(finding('approval_not_current', 'case.json#/approvals', `send readiness could not verify the ${approvalStage} approval: ${error.message}`, 'AC-08'));
      }
    }
  }

  const blockers = uniqueFindings(findings);
  return {
    schema_version: '1.0',
    contract: 'semantic_readiness',
    stage,
    ready: structural.valid && blockers.length === 0,
    structural_valid: structural.valid,
    findings: blockers,
  };
}
