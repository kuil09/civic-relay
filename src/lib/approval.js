import { randomUUID } from 'node:crypto';
import { APPROVAL_STAGES } from './constants.js';
import { computeStageHash } from './hash.js';
import { loadCase, nowIso, saveCase } from './io.js';
import { verifyRecipients } from './recipients.js';

const AI_ACTOR = /(^|\b)(ai|assistant|agent|model|chatgpt|gpt|claude|codex)(\b|$)/i;

export function latestApproval(caseData, stage) {
  return [...(caseData.approvals || [])]
    .filter((approval) => approval.stage === stage)
    .sort((a, b) => String(b.approved_at).localeCompare(String(a.approved_at)))[0] || null;
}

export async function approvalState(casePath, stage, caseData = null) {
  const data = caseData || (await loadCase(casePath));
  const approval = latestApproval(data, stage);
  if (!approval) return { valid: false, reason: 'missing', approval: null };
  if (!approval.confirmed_human) return { valid: false, reason: 'not_human_confirmed', approval };
  if (AI_ACTOR.test(approval.actor || '')) return { valid: false, reason: 'ai_actor', approval };
  const current = await computeStageHash(casePath, stage);
  if (current.hash !== approval.content_hash) {
    return { valid: false, reason: 'content_changed', approval, current_hash: current.hash };
  }
  return { valid: true, reason: 'valid', approval, current_hash: current.hash };
}

async function requirePreviousStages(casePath, stage, data) {
  const index = APPROVAL_STAGES.indexOf(stage);
  for (const required of APPROVAL_STAGES.slice(0, index)) {
    const state = await approvalState(casePath, required, data);
    if (!state.valid) throw new Error(`cannot approve ${stage}: ${required} approval is ${state.reason}`);
  }
}

export async function approveCase(casePath, options) {
  const { stage, actor, confirmHuman = false, note = '' } = options;
  if (!APPROVAL_STAGES.includes(stage)) throw new Error(`invalid stage: ${stage}`);
  if (!confirmHuman) throw new Error('approval requires --confirm-human');
  if (!actor || actor.trim().length < 2) throw new Error('approval requires a human actor name');
  if (AI_ACTOR.test(actor)) throw new Error('AI agents cannot be approval actors');

  const data = await loadCase(casePath);
  await requirePreviousStages(casePath, stage, data);

  if (stage === 'dispatch') {
    const verification = verifyRecipients(data, { maxAgeHours: 24, selectedOnly: true });
    if (verification.selectedCount === 0) throw new Error('dispatch approval requires at least one selected recipient');
    if (!verification.valid) throw new Error('dispatch approval requires current recipient verification');
  }

  const calculated = await computeStageHash(casePath, stage);
  const previous = latestApproval(data, stage);
  const approval = {
    approval_id: `approval-${randomUUID()}`,
    stage,
    actor: actor.trim(),
    confirmed_human: true,
    approved_at: nowIso(),
    content_hash: calculated.hash,
    scope: calculated.scope,
    supersedes: previous?.approval_id || null,
    note,
  };
  data.approvals ||= [];
  data.approvals.push(approval);

  const completed = [];
  for (const candidate of APPROVAL_STAGES.slice(0, 5)) {
    if ((await approvalState(casePath, candidate, { ...data, approvals: data.approvals })).valid) completed.push(candidate);
  }
  if (completed.length === 5) data.status = 'approved';
  else if (stage === 'recipients') data.status = 'review';
  else if (stage === 'policy') data.status = 'draft';
  else if (stage === 'evidence') data.status = 'research';

  await saveCase(casePath, data);
  return approval;
}
