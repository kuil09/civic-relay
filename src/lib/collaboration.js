import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { hashFile, sha256 } from './hash.js';
import {
  deepClone,
  loadCase,
  nowIso,
  pathExists,
  readJson,
  stableStringify,
  writeJsonAtomic,
} from './io.js';

export const COLLABORATION_ROLES = [
  'case_author',
  'evidence_reviewer',
  'policy_editor',
  'recipient_verifier',
  'dispatch_approver',
  'public_release_manager',
];

export const COLLABORATION_EVENT_TYPES = [
  'participant_registered',
  'contribution',
  'review',
  'dissent',
  'approval',
  'co_sign_consent',
  'consent_withdrawal',
];

const PARTICIPANT_KINDS = new Set(['human', 'ai', 'organization']);
const VISIBILITIES = new Set(['public', 'private']);
const HUMAN_ONLY_EVENTS = new Set(['approval', 'co_sign_consent', 'consent_withdrawal']);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const AI_LABEL = /(^|\b)(ai|assistant|agent|model|chatgpt|gpt|claude|codex)(\b|$)/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validDateTime(value) {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

function rejectUnknownKeys(value, allowed, pointer, errors) {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${pointer}/${key}: unknown field`);
  }
}

function normalizeEventType(value) {
  return String(value || '').replaceAll('-', '_');
}

function assertIdentifier(value, label) {
  if (!ID_PATTERN.test(String(value || ''))) {
    throw new Error(`${label} must match ${ID_PATTERN}`);
  }
  return String(value);
}

function targetFile(target) {
  const value = String(target || '');
  const separator = value.indexOf('#');
  const file = separator >= 0 ? value.slice(0, separator) : value;
  const fragment = separator >= 0 ? value.slice(separator + 1) : '';
  if (!file || file.includes('\\') || path.posix.isAbsolute(file)) {
    throw new Error(`target must begin with a safe relative file path: ${value}`);
  }
  const normalized = path.posix.normalize(file);
  if (normalized !== file || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`target must not traverse outside the case: ${value}`);
  }
  if (separator >= 0 && (!fragment || !fragment.startsWith('/'))) {
    throw new Error(`target fragment must be a JSON Pointer beginning with /: ${value}`);
  }
  if (separator >= 0 && path.posix.extname(file).toLowerCase() !== '.json') {
    throw new Error(`target fragments are supported only for JSON files: ${value}`);
  }
  if (file === 'collaboration.json') {
    throw new Error('target cannot be collaboration.json because the ledger cannot attest to itself');
  }
  return file;
}

export async function computeCollaborationTargetHash(casePath, target) {
  const file = targetFile(target);
  const absolute = path.resolve(casePath, file);
  const root = path.resolve(casePath);
  if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error(`target escapes case directory: ${target}`);
  if (!(await pathExists(absolute))) throw new Error(`target file does not exist: ${target}`);
  const stat = await fs.lstat(absolute);
  if (!stat.isFile()) throw new Error(`target must resolve to a file: ${target}`);
  return hashFile(absolute);
}

function entryHash(entry) {
  const { entry_hash: ignored, ...payload } = entry;
  return sha256(stableStringify(payload));
}

export function rechainCollaborationLedger(ledger) {
  const copy = deepClone(ledger);
  let previous = null;
  for (const entry of copy.entries || []) {
    entry.previous_entry_hash = previous;
    entry.entry_hash = entryHash(entry);
    previous = entry.entry_hash;
  }
  return copy;
}

function participantRegistrations(ledger) {
  return new Map(
    (ledger.entries || [])
      .filter((entry) => entry.event_type === 'participant_registered')
      .map((entry) => [entry.payload.participant_id, entry.payload]),
  );
}

function validateRegistrationPayload(payload, pointer, errors) {
  if (!isPlainObject(payload)) {
    errors.push(`${pointer}: payload must be an object`);
    return;
  }
  rejectUnknownKeys(payload, ['participant_id', 'display_name', 'participant_kind', 'roles', 'visibility'], pointer, errors);
  if (!ID_PATTERN.test(String(payload.participant_id || ''))) errors.push(`${pointer}/participant_id: invalid participant ID`);
  if (typeof payload.display_name !== 'string' || !payload.display_name.trim()) errors.push(`${pointer}/display_name: display name is required`);
  if (!PARTICIPANT_KINDS.has(payload.participant_kind)) errors.push(`${pointer}/participant_kind: invalid participant kind`);
  if (payload.participant_kind === 'human' && AI_LABEL.test(payload.display_name || '')) {
    errors.push(`${pointer}/display_name: an AI-labelled participant cannot be registered as human`);
  }
  if (!Array.isArray(payload.roles) || payload.roles.length === 0) errors.push(`${pointer}/roles: at least one role is required`);
  else {
    const seen = new Set();
    for (const role of payload.roles) {
      if (!COLLABORATION_ROLES.includes(role)) errors.push(`${pointer}/roles: invalid role ${role}`);
      if (seen.has(role)) errors.push(`${pointer}/roles: duplicate role ${role}`);
      seen.add(role);
    }
  }
  if (!VISIBILITIES.has(payload.visibility)) errors.push(`${pointer}/visibility: invalid visibility`);
}

function validateActionPayload(entry, pointer, entriesById, errors) {
  const payload = entry.payload;
  if (!isPlainObject(payload)) {
    errors.push(`${pointer}/payload: payload must be an object`);
    return;
  }
  const allowed = entry.event_type === 'approval' || entry.event_type === 'co_sign_consent'
    ? ['summary', 'identity_id', 'confirmed_human']
    : entry.event_type === 'consent_withdrawal'
      ? ['summary', 'consent_entry_id', 'confirmed_human']
      : ['summary'];
  rejectUnknownKeys(payload, allowed, `${pointer}/payload`, errors);
  if (typeof payload.summary !== 'string') errors.push(`${pointer}/payload/summary: summary must be a string`);

  if (entry.event_type === 'approval' || entry.event_type === 'co_sign_consent') {
    if (!ID_PATTERN.test(String(payload.identity_id || ''))) errors.push(`${pointer}/payload/identity_id: valid identity ID is required`);
    if (payload.confirmed_human !== true) errors.push(`${pointer}/payload/confirmed_human: explicit human confirmation is required`);
  }

  if (entry.event_type === 'consent_withdrawal') {
    if (!ID_PATTERN.test(String(payload.consent_entry_id || ''))) errors.push(`${pointer}/payload/consent_entry_id: valid consent entry ID is required`);
    if (payload.confirmed_human !== true) errors.push(`${pointer}/payload/confirmed_human: explicit human confirmation is required`);
    const consent = entriesById.get(payload.consent_entry_id);
    if (!consent || consent.event_type !== 'co_sign_consent') {
      errors.push(`${pointer}/payload/consent_entry_id: referenced co-sign consent does not exist earlier in the ledger`);
    } else {
      if (consent.actor_id !== entry.actor_id) errors.push(`${pointer}/actor_id: only the consent actor can withdraw the consent`);
      if (consent.target !== entry.target) errors.push(`${pointer}/target: withdrawal target must match the consent target`);
    }
  }
}

export function validateCollaborationLedger(ledger, options = {}) {
  const errors = [];
  if (!isPlainObject(ledger)) return { valid: false, errors: ['collaboration.json: ledger must be an object'] };
  rejectUnknownKeys(ledger, ['schema_version', 'case_id', 'created_at', 'public_copy', 'entries'], 'collaboration.json#', errors);
  if (ledger.schema_version !== '1.0') errors.push('collaboration.json#/schema_version: schema_version must be 1.0');
  if (!ID_PATTERN.test(String(ledger.case_id || ''))) errors.push('collaboration.json#/case_id: invalid case ID');
  if (options.caseId && ledger.case_id !== options.caseId) errors.push('collaboration.json#/case_id: case ID does not match case.json');
  if (!validDateTime(ledger.created_at)) errors.push('collaboration.json#/created_at: valid date-time is required');
  if ('public_copy' in ledger && ledger.public_copy !== true) errors.push('collaboration.json#/public_copy: public_copy must be true when present');
  if (!Array.isArray(ledger.entries)) {
    errors.push('collaboration.json#/entries: entries must be an array');
    return { valid: false, errors };
  }

  const participants = new Map();
  const entriesById = new Map();
  let previousHash = null;
  let previousTime = '';
  for (let index = 0; index < ledger.entries.length; index += 1) {
    const entry = ledger.entries[index];
    const pointer = `collaboration.json#/entries/${index}`;
    if (!isPlainObject(entry)) {
      errors.push(`${pointer}: entry must be an object`);
      continue;
    }
    rejectUnknownKeys(entry, [
      'entry_id',
      'event_type',
      'actor_id',
      'occurred_at',
      'target',
      'document_hash',
      'payload',
      'previous_entry_hash',
      'entry_hash',
    ], pointer, errors);
    if (!ID_PATTERN.test(String(entry.entry_id || ''))) errors.push(`${pointer}/entry_id: invalid entry ID`);
    else if (entriesById.has(entry.entry_id)) errors.push(`${pointer}/entry_id: duplicate entry ID ${entry.entry_id}`);
    if (!COLLABORATION_EVENT_TYPES.includes(entry.event_type)) errors.push(`${pointer}/event_type: invalid event type`);
    if (!ID_PATTERN.test(String(entry.actor_id || ''))) errors.push(`${pointer}/actor_id: invalid actor ID`);
    if (!validDateTime(entry.occurred_at)) errors.push(`${pointer}/occurred_at: valid date-time is required`);
    else if (previousTime && entry.occurred_at < previousTime) errors.push(`${pointer}/occurred_at: entries must remain chronological`);
    if (typeof entry.target !== 'string') errors.push(`${pointer}/target: target is required`);
    else {
      try { targetFile(entry.target); }
      catch (error) { errors.push(`${pointer}/target: ${error.message}`); }
    }
    if (!HASH_PATTERN.test(String(entry.document_hash || ''))) errors.push(`${pointer}/document_hash: SHA-256 hash is required`);
    if (entry.previous_entry_hash !== previousHash) errors.push(`${pointer}/previous_entry_hash: hash chain is broken`);
    if (!HASH_PATTERN.test(String(entry.entry_hash || ''))) errors.push(`${pointer}/entry_hash: SHA-256 hash is required`);
    else if (entry.entry_hash !== entryHash(entry)) errors.push(`${pointer}/entry_hash: entry content does not match its hash`);

    if (entry.event_type === 'participant_registered') {
      validateRegistrationPayload(entry.payload, `${pointer}/payload`, errors);
      const participantId = entry.payload?.participant_id;
      if (participants.has(participantId)) errors.push(`${pointer}/payload/participant_id: participant is already registered`);
      if (entry.actor_id !== participantId && !participants.has(entry.actor_id)) {
        errors.push(`${pointer}/actor_id: registrar must already be registered or self-register`);
      }
      if (participantId) participants.set(participantId, entry.payload);
    } else {
      validateActionPayload(entry, pointer, entriesById, errors);
      const actor = participants.get(entry.actor_id);
      if (!actor) errors.push(`${pointer}/actor_id: actor must be registered before recording an event`);
      if (HUMAN_ONLY_EVENTS.has(entry.event_type)) {
        if (actor?.participant_kind !== 'human') errors.push(`${pointer}/actor_id: ${entry.event_type} requires a human actor`);
        if (AI_LABEL.test(actor?.display_name || '')) errors.push(`${pointer}/actor_id: AI-labelled actors cannot create human approval or consent records`);
      }
      const identityId = entry.payload?.identity_id;
      if (identityId && !participants.has(identityId)) errors.push(`${pointer}/payload/identity_id: represented identity must be registered`);
      if (identityId && identityId !== entry.actor_id) {
        const identity = participants.get(identityId);
        if (identity?.participant_kind !== 'organization') {
          errors.push(`${pointer}/payload/identity_id: a human actor can represent only itself or a registered organization`);
        }
        if (!actor?.roles?.includes('public_release_manager')) {
          errors.push(`${pointer}/actor_id: organization representation requires the public_release_manager role and explicit human confirmation`);
        }
      }
    }

    if (entry.entry_id) entriesById.set(entry.entry_id, entry);
    previousHash = entry.entry_hash;
    previousTime = entry.occurred_at || previousTime;
  }
  return { valid: errors.length === 0, errors };
}

async function loadLedgerState(casePath, required) {
  const file = path.join(casePath, 'collaboration.json');
  if (!(await pathExists(file))) {
    if (required) throw new Error('collaboration.json: collaboration ledger is not initialized');
    return null;
  }
  const ledger = await readJson(file);
  const data = await loadCase(casePath);
  const validation = validateCollaborationLedger(ledger, { caseId: data.case_id });
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  return ledger;
}

export async function loadCollaborationLedger(casePath, options = {}) {
  return loadLedgerState(casePath, Boolean(options.required));
}

async function appendEntry(casePath, ledger, entry) {
  const previous = ledger.entries.at(-1)?.entry_hash || null;
  const complete = {
    ...entry,
    previous_entry_hash: previous,
  };
  complete.entry_hash = entryHash(complete);
  ledger.entries.push(complete);
  const validation = validateCollaborationLedger(ledger, { caseId: ledger.case_id });
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  await writeJsonAtomic(path.join(casePath, 'collaboration.json'), ledger);
  return complete;
}

export async function registerParticipant(casePath, options) {
  const participantId = assertIdentifier(options.participantId, 'participant ID');
  const participantKind = String(options.participantKind || 'human');
  const displayName = String(options.displayName || '').trim();
  const roles = [...new Set(options.roles || [])];
  const visibility = options.visibility || 'private';
  const actorId = assertIdentifier(options.recordedBy || participantId, 'recorded-by actor ID');
  const target = String(options.target || 'case.json');
  if (!displayName) throw new Error('display name is required');
  if (!PARTICIPANT_KINDS.has(participantKind)) throw new Error(`invalid participant kind: ${participantKind}`);
  if (participantKind === 'human' && AI_LABEL.test(displayName)) throw new Error('AI-labelled participants cannot be registered as human');
  if (roles.length === 0 || roles.some((role) => !COLLABORATION_ROLES.includes(role))) {
    throw new Error(`roles must contain one or more of: ${COLLABORATION_ROLES.join(', ')}`);
  }
  if (!VISIBILITIES.has(visibility)) throw new Error(`invalid visibility: ${visibility}`);

  const data = await loadCase(casePath);
  let ledger = await loadLedgerState(casePath, false);
  if (!ledger) ledger = { schema_version: '1.0', case_id: data.case_id, created_at: nowIso(), entries: [] };
  const participants = participantRegistrations(ledger);
  if (participants.has(participantId)) throw new Error(`participant is already registered: ${participantId}`);
  if (actorId !== participantId && !participants.has(actorId)) throw new Error(`recorded-by actor is not registered: ${actorId}`);

  return appendEntry(casePath, ledger, {
    entry_id: `entry-${randomUUID()}`,
    event_type: 'participant_registered',
    actor_id: actorId,
    occurred_at: nowIso(),
    target,
    document_hash: await computeCollaborationTargetHash(casePath, target),
    payload: {
      participant_id: participantId,
      display_name: displayName,
      participant_kind: participantKind,
      roles,
      visibility,
    },
  });
}

export async function recordCollaborationEvent(casePath, options) {
  const ledger = await loadLedgerState(casePath, true);
  const eventType = normalizeEventType(options.eventType);
  const actorId = assertIdentifier(options.actorId, 'actor ID');
  const target = String(options.target || '');
  if (!COLLABORATION_EVENT_TYPES.includes(eventType) || eventType === 'participant_registered') {
    throw new Error(`invalid record event type: ${options.eventType}`);
  }
  const participants = participantRegistrations(ledger);
  const actor = participants.get(actorId);
  if (!actor) throw new Error(`actor is not registered: ${actorId}`);
  if (HUMAN_ONLY_EVENTS.has(eventType)) {
    if (options.confirmHuman !== true) throw new Error(`${eventType} requires --confirm-human`);
    if (actor.participant_kind !== 'human' || AI_LABEL.test(actor.display_name || '')) {
      throw new Error(`${eventType} requires a human actor; AI and organization actors are not permitted`);
    }
  }

  const payload = { summary: String(options.summary || '') };
  if (eventType === 'approval' || eventType === 'co_sign_consent') {
    payload.identity_id = assertIdentifier(options.identityId || actorId, 'identity ID');
    if (!participants.has(payload.identity_id)) throw new Error(`represented identity is not registered: ${payload.identity_id}`);
    if (payload.identity_id !== actorId) {
      const identity = participants.get(payload.identity_id);
      if (identity.participant_kind !== 'organization') {
        throw new Error('a human actor can represent only itself or a registered organization');
      }
      if (!actor.roles.includes('public_release_manager')) {
        throw new Error('organization representation requires the public_release_manager role and explicit human confirmation');
      }
    }
    payload.confirmed_human = true;
  }
  if (eventType === 'consent_withdrawal') {
    payload.consent_entry_id = assertIdentifier(options.consentEntryId, 'consent entry ID');
    payload.confirmed_human = true;
  }

  return appendEntry(casePath, ledger, {
    entry_id: `entry-${randomUUID()}`,
    event_type: eventType,
    actor_id: actorId,
    occurred_at: nowIso(),
    target,
    document_hash: await computeCollaborationTargetHash(casePath, target),
    payload,
  });
}

export async function collaborationStatus(casePath, options = {}) {
  const ledger = await loadLedgerState(casePath, false);
  if (!ledger) {
    return {
      enabled: false,
      target: options.target || null,
      participants: [],
      current_consents: [],
      stale_consents: [],
      withdrawn_consents: [],
      joint_attribution_valid: false,
      reason: 'collaboration_not_initialized',
    };
  }
  const target = String(options.target || '');
  const currentHash = await computeCollaborationTargetHash(casePath, target);
  const participants = participantRegistrations(ledger);
  const withdrawn = new Set(
    ledger.entries
      .filter((entry) => entry.event_type === 'consent_withdrawal')
      .map((entry) => entry.payload.consent_entry_id),
  );
  const consents = ledger.entries
    .filter((entry) => entry.event_type === 'co_sign_consent' && entry.target === target)
    .map((entry) => ({
      entry_id: entry.entry_id,
      actor_id: entry.actor_id,
      identity_id: entry.payload.identity_id,
      document_hash: entry.document_hash,
      occurred_at: entry.occurred_at,
      withdrawn: withdrawn.has(entry.entry_id),
      current: entry.document_hash === currentHash && ledger.public_copy !== true,
    }));
  const currentConsents = consents.filter((entry) => entry.current && !entry.withdrawn);
  const staleConsents = consents.filter((entry) => !entry.current && !entry.withdrawn);
  const withdrawnConsents = consents.filter((entry) => entry.withdrawn);
  const requiredIdentities = [...new Set(options.requiredIdentities || [])];
  const currentIdentityIds = new Set(currentConsents.map((entry) => entry.identity_id));
  const missingIdentities = requiredIdentities.filter((identity) => !currentIdentityIds.has(identity));
  let reason = 'valid';
  if (ledger.public_copy === true) reason = 'public_copy_non_authoritative';
  else if (requiredIdentities.length === 0) reason = 'required_identities_missing';
  else if (missingIdentities.length) reason = 'explicit_current_consent_missing';

  return {
    enabled: true,
    target,
    current_document_hash: currentHash,
    participants: [...participants.entries()].map(([participant_id, participant]) => ({ participant_id, ...participant })),
    current_consents: currentConsents,
    stale_consents: staleConsents,
    withdrawn_consents: withdrawnConsents,
    required_identities: requiredIdentities,
    missing_identities: missingIdentities,
    joint_attribution_valid: ledger.public_copy !== true && requiredIdentities.length > 0 && missingIdentities.length === 0,
    reason,
  };
}

export function sanitizeCollaborationLedgerForPublic(ledger) {
  const copy = deepClone(ledger);
  copy.public_copy = true;
  const privateIds = new Map();
  const privateNames = new Map();
  let sequence = 0;
  for (const entry of copy.entries || []) {
    if (entry.event_type !== 'participant_registered' || entry.payload?.visibility !== 'private') continue;
    sequence += 1;
    privateIds.set(entry.payload.participant_id, `private-participant-${String(sequence).padStart(3, '0')}`);
    privateNames.set(entry.payload.participant_id, entry.payload.display_name);
  }
  const mapId = (value) => privateIds.get(value) || value;
  const redactPrivateReferences = (value) => {
    let result = String(value || '');
    for (const [participantId, pseudonym] of privateIds) {
      result = result.replaceAll(participantId, pseudonym);
      const displayName = privateNames.get(participantId);
      if (displayName) result = result.replaceAll(displayName, 'Private participant');
    }
    return result;
  };
  for (const entry of copy.entries || []) {
    entry.actor_id = mapId(entry.actor_id);
    if (entry.payload?.participant_id) entry.payload.participant_id = mapId(entry.payload.participant_id);
    if (entry.payload?.identity_id) entry.payload.identity_id = mapId(entry.payload.identity_id);
    if (typeof entry.payload?.summary === 'string') entry.payload.summary = redactPrivateReferences(entry.payload.summary);
    if (entry.event_type === 'participant_registered' && entry.payload?.visibility === 'private') {
      entry.payload.display_name = 'Private participant';
    }
  }
  return { ledger: rechainCollaborationLedger(copy), redactedParticipants: privateIds.size };
}
