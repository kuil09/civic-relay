const ALLOWED_CHANNEL_PREFIXES = ['mailto:', 'https://', 'postal:', 'tel:'];

export function isOfficialChannelShape(channel) {
  return typeof channel === 'string' && ALLOWED_CHANNEL_PREFIXES.some((prefix) => channel.startsWith(prefix));
}

export function verificationState(recipient, options = {}) {
  const { maxAgeHours = 24, now = new Date() } = options;
  if (!recipient.selected) return { valid: true, state: 'not_selected', ageHours: null };
  if (recipient.verification_status !== 'valid') {
    return { valid: false, state: recipient.verification_status || 'unverified', ageHours: null };
  }
  if (!recipient.official_channel || !isOfficialChannelShape(recipient.official_channel)) {
    return { valid: false, state: 'invalid_official_channel', ageHours: null };
  }
  if (!recipient.channel_source) return { valid: false, state: 'missing_channel_source', ageHours: null };
  if (!recipient.verified_at) return { valid: false, state: 'missing_verified_at', ageHours: null };
  const verified = new Date(recipient.verified_at);
  if (Number.isNaN(verified.getTime())) return { valid: false, state: 'invalid_verified_at', ageHours: null };
  const ageHours = (now.getTime() - verified.getTime()) / 3_600_000;
  if (ageHours < -0.05) return { valid: false, state: 'verification_in_future', ageHours };
  if (ageHours > maxAgeHours) return { valid: false, state: 'stale', ageHours };
  return { valid: true, state: 'valid', ageHours };
}

export function verifyRecipients(caseData, options = {}) {
  const { maxAgeHours = 24, selectedOnly = true, now = new Date() } = options;
  const results = [];
  const seen = new Map();

  for (const recipient of caseData.recipients || []) {
    if (selectedOnly && !recipient.selected) continue;
    const key = `${String(recipient.organization || '').trim().toLowerCase()}|${String(recipient.official_channel || '').trim().toLowerCase()}`;
    const state = verificationState(recipient, { maxAgeHours, now });
    const issues = [];
    if (!recipient.reason) issues.push('missing_reason');
    if (!recipient.expected_action) issues.push('missing_expected_action');
    if (seen.has(key) && key !== '|') issues.push(`duplicate_of:${seen.get(key)}`);
    else seen.set(key, recipient.recipient_id);
    if (!state.valid) issues.push(state.state);
    results.push({ recipient_id: recipient.recipient_id, valid: issues.length === 0, issues, ...state });
  }

  return {
    valid: results.every((result) => result.valid),
    selectedCount: (caseData.recipients || []).filter((recipient) => recipient.selected).length,
    results,
  };
}
