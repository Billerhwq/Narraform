const TITLE_WORDS = /标题|题目/;
const BODY_WORDS = /正文|内容|开头|结尾|段落|第[一二三四五六七八九十\d]+段|全文|整篇|这段|选中/;
const META_WORDS = /摘要|话题|标签|关键词/;

export function resolveCustomOperation(instruction = '', selection = null) {
  const text = String(instruction).trim();
  const targetFields = [];
  if (TITLE_WORDS.test(text)) targetFields.push('titleCandidates', 'selectedTitleIndex');
  if (BODY_WORDS.test(text) || selection?.selectedText) targetFields.push('bodyMarkdown');
  if (/摘要/.test(text)) targetFields.push('summary');
  if (META_WORDS.test(text)) targetFields.push('topics');
  if (!targetFields.length) targetFields.push('bodyMarkdown');
  return {
    operation: 'custom_modify',
    scope: selection?.selectedText ? 'selection' : 'document',
    targetFields: [...new Set(targetFields)],
    instruction: text,
  };
}
