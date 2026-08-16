const VERSION = '2026.08-v1';

const specs = {
  generate: {
    id: 'generate',
    version: VERSION,
    writableFields: ['titleCandidates', 'selectedTitleIndex', 'summary', 'bodyMarkdown', 'topics', 'commentPrompt', 'mediaNotes', 'purpose', 'alternatives'],
    preservedFields: [],
    requiresCurrentResult: false,
    maxQualityRetries: 2,
  },
  regenerate_titles: {
    id: 'regenerate_titles',
    version: VERSION,
    writableFields: ['titleCandidates', 'selectedTitleIndex'],
    preservedFields: ['bodyMarkdown', 'summary', 'topics', 'commentPrompt', 'mediaNotes', 'purpose', 'alternatives'],
    requiresCurrentResult: true,
    maxQualityRetries: 2,
  },
  regenerate_body: {
    id: 'regenerate_body',
    version: VERSION,
    writableFields: ['bodyMarkdown'],
    preservedFields: ['titleCandidates', 'selectedTitleIndex', 'summary', 'topics', 'commentPrompt', 'mediaNotes', 'purpose', 'alternatives'],
    requiresCurrentResult: true,
    maxQualityRetries: 2,
  },
  polish: {
    id: 'polish',
    version: VERSION,
    writableFields: ['bodyMarkdown'],
    preservedFields: ['titleCandidates', 'selectedTitleIndex', 'summary', 'topics', 'commentPrompt', 'mediaNotes', 'purpose', 'alternatives'],
    requiresCurrentResult: true,
    maxQualityRetries: 2,
  },
  custom_modify: {
    id: 'custom_modify',
    version: VERSION,
    writableFields: [],
    preservedFields: [],
    requiresCurrentResult: true,
    maxQualityRetries: 2,
  },
};

export const CONTENT_FIELDS = ['titleCandidates', 'selectedTitleIndex', 'summary', 'bodyMarkdown', 'topics', 'commentPrompt', 'mediaNotes', 'purpose', 'alternatives'];
export const OPERATION_IDS = Object.freeze(Object.keys(specs));

export function validateOperationSpec(spec) {
  if (!spec?.id || !spec.version || !Array.isArray(spec.writableFields) || !Array.isArray(spec.preservedFields)) throw new Error('OperationSpec 结构无效');
  const overlap = spec.writableFields.filter((field) => spec.preservedFields.includes(field));
  if (overlap.length) throw new Error(`OperationSpec ${spec.id} 字段权限冲突: ${overlap.join(', ')}`);
  return true;
}

Object.values(specs).forEach(validateOperationSpec);

export function getOperationSpec(operation, targetFields = [], platform = null) {
  const base = specs[operation];
  if (!base) {
    const error = new Error(`不支持的内容操作: ${operation || 'empty'}`);
    error.code = 'INVALID_OPERATION';
    error.status = 400;
    throw error;
  }
  if (operation !== 'custom_modify') {
    if (operation === 'regenerate_body' && platform === 'xiaohongshu') {
      return {
        ...base,
        writableFields: ['bodyMarkdown', 'topics', 'commentPrompt'],
        preservedFields: base.preservedFields.filter((field) => !['topics', 'commentPrompt'].includes(field)),
      };
    }
    return { ...base, writableFields: [...base.writableFields], preservedFields: [...base.preservedFields] };
  }
  const writableFields = [...new Set(targetFields)].filter((field) => CONTENT_FIELDS.includes(field));
  if (!writableFields.length) {
    const error = new Error('无法确定要修改标题还是正文');
    error.code = 'INVALID_SCOPE';
    error.status = 400;
    throw error;
  }
  return { ...base, writableFields, preservedFields: CONTENT_FIELDS.filter((field) => !writableFields.includes(field)) };
}

export function getPublicOperationSpecs() {
  return Object.values(specs).map((spec) => ({ ...spec }));
}
