import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RESPONSE_CLASSIFICATIONS } from './constants.js';
import { ensureDir, loadCase, nowIso, safeFileName, saveCase, writeTextAtomic } from './io.js';

export async function recordResponse(casePath, options) {
  const { recipientId, classification, sourceFile, summary = '', followUpTasks = [] } = options;
  if (!RESPONSE_CLASSIFICATIONS.includes(classification)) throw new Error(`invalid response classification: ${classification}`);
  const data = await loadCase(casePath);
  if (!(data.recipients || []).some((item) => item.recipient_id === recipientId)) throw new Error(`unknown recipient: ${recipientId}`);
  const receivedAt = nowIso();
  const responseId = `response-${randomUUID()}`;
  const raw = await fs.readFile(sourceFile, 'utf8');
  const relative = `11-responses/${receivedAt.replaceAll(':', '-').replace('.', '-')}-${safeFileName(recipientId)}.md`;
  const content = `---
response_id: ${responseId}
recipient_id: ${recipientId}
classification: ${classification}
received_at: ${receivedAt}
---

# 원문

${raw}

# AI 요약

${summary || '요약 미작성'}

# 후속 작업

${followUpTasks.length ? followUpTasks.map((item) => `- ${item}`).join('\n') : '- 없음 또는 미분류'}
`;
  await ensureDir(path.join(casePath, '11-responses'));
  await writeTextAtomic(path.join(casePath, relative), content);
  data.responses ||= [];
  data.responses.push({
    response_id: responseId,
    dispatch_id: null,
    recipient_id: recipientId,
    classification,
    received_at: receivedAt,
    original_file: relative,
    summary,
    follow_up_tasks: followUpTasks,
    human_corrected: false,
    notes: '',
  });
  data.status = 'follow_up';
  await saveCase(casePath, data);
  return data.responses.at(-1);
}
