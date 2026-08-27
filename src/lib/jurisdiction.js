import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFilesRecursive, readJson } from './io.js';

export const DEFAULT_JURISDICTION_ROOT = fileURLToPath(
  new URL('../../adapters/jurisdiction/', import.meta.url),
);

const ADAPTER_ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
const REQUIRED_ARRAYS = ['legal_layers', 'authority_types', 'official_sources', 'recipient_roles'];
const FORBIDDEN_KEYS = new Set([
  'current_holders',
  'current_holder',
  'office_holders',
  'office_holder',
  'holder_name',
  'person_name',
  'members',
  'member_names',
  'contacts',
  'contact_list',
  'email',
  'emails',
  'phone',
  'phones',
]);
const DIRECT_CONTACT = /(?:mailto:[^\s]*@|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b01[016789][- .]?\d{3,4}[- .]?\d{4}\b|\+\d{1,3}[ .()-]\d[\d .()-]{6,}\d)/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function duplicates(values) {
  const seen = new Set();
  const output = new Set();
  for (const value of values) {
    if (seen.has(value)) output.add(value);
    seen.add(value);
  }
  return [...output];
}

function inspectForbidden(value, pointer, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectForbidden(item, `${pointer}/${index}`, errors));
    return;
  }
  if (!isPlainObject(value)) {
    if (typeof value === 'string' && DIRECT_CONTACT.test(value)) {
      errors.push(`${pointer || '/'}: direct personal contact data is not allowed in jurisdiction adapters`);
    }
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const next = `${pointer}/${key}`;
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      errors.push(`${next}: current office-holder and direct contact fields are not allowed`);
    }
    inspectForbidden(nested, next, errors);
  }
}

function validateIdentifiedArray(adapter, key, errors) {
  const items = adapter[key];
  if (!Array.isArray(items) || items.length === 0) {
    errors.push(`/${key}: must be a non-empty array`);
    return;
  }
  const ids = [];
  items.forEach((item, index) => {
    if (!isPlainObject(item)) {
      errors.push(`/${key}/${index}: must be an object`);
      return;
    }
    const idKey = key === 'official_sources' ? 'source_id' : 'id';
    if (typeof item[idKey] !== 'string' || item[idKey].trim() === '') {
      errors.push(`/${key}/${index}/${idKey}: must be a non-empty string`);
    } else ids.push(item[idKey]);
    if (typeof item.label !== 'string' && typeof item.name !== 'string') {
      errors.push(`/${key}/${index}: requires label or name`);
    }
  });
  for (const id of duplicates(ids)) errors.push(`/${key}: duplicate id ${id}`);
}

export function validateJurisdictionAdapter(adapter, options = {}) {
  const { expectedId = null } = options;
  const errors = [];
  if (!isPlainObject(adapter)) return { valid: false, errors: ['/: adapter must be an object'] };
  if (adapter.schema_version !== '1.0') errors.push('/schema_version: must equal 1.0');
  if (typeof adapter.id !== 'string' || !ADAPTER_ID.test(adapter.id)) {
    errors.push('/id: must match ^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$');
  }
  if (expectedId && adapter.id !== expectedId) errors.push(`/id: expected ${expectedId}, found ${adapter.id}`);
  if (typeof adapter.name !== 'string' || adapter.name.trim() === '') errors.push('/name: must be a non-empty string');
  if (typeof adapter.scope !== 'string' || adapter.scope.trim() === '') errors.push('/scope: must be a non-empty string');
  if (typeof adapter.default_locale !== 'string' || adapter.default_locale.trim() === '') errors.push('/default_locale: required');
  if (typeof adapter.default_timezone !== 'string' || adapter.default_timezone.trim() === '') errors.push('/default_timezone: required');

  for (const key of REQUIRED_ARRAYS) validateIdentifiedArray(adapter, key, errors);

  const legalLayers = Array.isArray(adapter.legal_layers) ? adapter.legal_layers : [];
  const ranks = legalLayers.map((item) => item?.rank).filter((value) => Number.isInteger(value));
  if (ranks.length !== legalLayers.length) errors.push('/legal_layers: every layer requires an integer rank');
  for (const rank of duplicates(ranks)) errors.push(`/legal_layers: duplicate rank ${rank}`);

  const sources = Array.isArray(adapter.official_sources) ? adapter.official_sources : [];
  const sourceIds = new Set(sources.map((item) => item?.source_id).filter(Boolean));
  sources.forEach((source, index) => {
    if (typeof source.base_url !== 'string' || !source.base_url.startsWith('https://')) {
      errors.push(`/official_sources/${index}/base_url: must be an HTTPS URL`);
    }
    if (!['primary', 'authoritative', 'reference'].includes(source.authority)) {
      errors.push(`/official_sources/${index}/authority: must be primary, authoritative, or reference`);
    }
    if (!Array.isArray(source.purposes) || source.purposes.length === 0) {
      errors.push(`/official_sources/${index}/purposes: must be a non-empty array`);
    }
  });

  const authorityIds = new Set(
    (Array.isArray(adapter.authority_types) ? adapter.authority_types : []).map((item) => item?.id).filter(Boolean),
  );
  const roles = Array.isArray(adapter.recipient_roles) ? adapter.recipient_roles : [];
  roles.forEach((role, index) => {
    if (!authorityIds.has(role.authority_type)) {
      errors.push(`/recipient_roles/${index}/authority_type: unknown authority type ${role.authority_type}`);
    }
    if (!Array.isArray(role.resolver_source_ids) || role.resolver_source_ids.length === 0) {
      errors.push(`/recipient_roles/${index}/resolver_source_ids: must be a non-empty array`);
    } else {
      for (const sourceId of role.resolver_source_ids) {
        if (!sourceIds.has(sourceId)) {
          errors.push(`/recipient_roles/${index}/resolver_source_ids: unknown source ${sourceId}`);
        }
      }
    }
  });

  if (!isPlainObject(adapter.normalization)) errors.push('/normalization: must be an object');
  else {
    if (adapter.normalization.locale !== adapter.default_locale) errors.push('/normalization/locale: must match default_locale');
    if (adapter.normalization.timezone !== adapter.default_timezone) errors.push('/normalization/timezone: must match default_timezone');
    if (!Array.isArray(adapter.normalization.channel_schemes) || adapter.normalization.channel_schemes.length === 0) {
      errors.push('/normalization/channel_schemes: must be a non-empty array');
    }
  }

  if (!isPlainObject(adapter.verification_policy)) errors.push('/verification_policy: must be an object');
  else {
    for (const key of ['recipient_ttl_hours', 'law_ttl_hours']) {
      if (!Number.isFinite(adapter.verification_policy[key]) || adapter.verification_policy[key] <= 0) {
        errors.push(`/verification_policy/${key}: must be a positive number`);
      }
    }
    if (adapter.verification_policy.official_source_required !== true) {
      errors.push('/verification_policy/official_source_required: must be true');
    }
    if (adapter.verification_policy.unknown_id_policy !== 'error') {
      errors.push('/verification_policy/unknown_id_policy: must equal error');
    }
  }

  inspectForbidden(adapter, '', errors);
  return { valid: errors.length === 0, errors };
}

export async function listJurisdictionAdapters(root = DEFAULT_JURISDICTION_ROOT) {
  const files = (await listFilesRecursive(root))
    .filter((file) => path.extname(file).toLowerCase() === '.json')
    .sort((a, b) => a.localeCompare(b));
  const adapters = [];
  const seen = new Set();
  for (const file of files) {
    const adapter = await readJson(file);
    const expectedId = path.basename(file, '.json');
    const result = validateJurisdictionAdapter(adapter, { expectedId });
    if (!result.valid) throw new Error(`invalid jurisdiction adapter ${file}: ${result.errors.join('; ')}`);
    if (seen.has(adapter.id)) throw new Error(`duplicate jurisdiction adapter id: ${adapter.id}`);
    seen.add(adapter.id);
    adapters.push({
      id: adapter.id,
      name: adapter.name,
      scope: adapter.scope,
      default_locale: adapter.default_locale,
      default_timezone: adapter.default_timezone,
      file,
    });
  }
  return adapters;
}

export async function loadJurisdictionAdapter(id, options = {}) {
  if (typeof id !== 'string' || !ADAPTER_ID.test(id)) throw new Error(`invalid jurisdiction adapter id: ${id}`);
  const root = options.root || DEFAULT_JURISDICTION_ROOT;
  const file = path.join(root, `${id}.json`);
  let adapter;
  try {
    adapter = await readJson(file);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`unknown jurisdiction adapter: ${id}`);
    throw error;
  }
  const result = validateJurisdictionAdapter(adapter, { expectedId: id });
  if (!result.valid) throw new Error(`invalid jurisdiction adapter ${id}: ${result.errors.join('; ')}`);
  return adapter;
}
