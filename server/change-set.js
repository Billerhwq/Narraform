import crypto from 'node:crypto';
import { CONTENT_FIELDS } from './operation-specs.js';

export function hashContent(value = '') {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function textStats(before = '', after = '') {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  return {
    beforeLength: before.length,
    afterLength: after.length,
    removed: before.slice(prefix, before.length - suffix),
    added: after.slice(prefix, after.length - suffix),
    start: prefix,
  };
}

export function createChangeSet(before = {}, after = {}) {
  const fields = {};
  for (const field of CONTENT_FIELDS) {
    if (JSON.stringify(before?.[field]) === JSON.stringify(after?.[field])) continue;
    fields[field] = typeof before?.[field] === 'string' && typeof after?.[field] === 'string'
      ? textStats(before[field], after[field])
      : { before: before?.[field] ?? null, after: after?.[field] ?? null };
  }
  return {
    changedFields: Object.keys(fields),
    fields,
    beforeHash: hashContent(before?.bodyMarkdown || ''),
    afterHash: hashContent(after?.bodyMarkdown || ''),
  };
}

export function replaceSelection(body, selection, replacement) {
  if (!selection?.selectedText) return replacement;
  const start = Number(selection.start);
  const end = Number(selection.end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || body.slice(start, end) !== selection.selectedText) {
    const error = new Error('选中的内容已经变化，请重新选择');
    error.code = 'CONTENT_STALE';
    error.status = 409;
    throw error;
  }
  return body.slice(0, start) + replacement + body.slice(end);
}
