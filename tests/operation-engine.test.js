import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import app from '../server/index.js';
import { createChangeSet, hashContent } from '../server/change-set.js';
import { executeContentOperation } from '../server/operation-engine.js';
import { getOperationSpec, getPublicOperationSpecs, validateOperationSpec } from '../server/operation-specs.js';

const currentResult = {
  resultId: 'result-parent',
  platform: 'generic',
  platformMode: null,
  titleCandidates: ['保留标题'],
  selectedTitleIndex: 0,
  summary: '保留摘要',
  bodyMarkdown: '第一段需要保留。\n\n在当今快速发展的时代，第二段需要润色。',
  topics: ['保留话题'],
  strategySnapshot: { id: 'strategy-1' },
  factIds: ['fact-1'],
};

function request(operation, extra = {}) {
  return {
    operation,
    platform: 'generic',
    baseInstruction: '产品支持导出内容。请写一份说明。',
    currentResult,
    parentResultId: currentResult.resultId,
    bodyHash: hashContent(currentResult.bodyMarkdown),
    ...extra,
  };
}

test('五个 OperationSpec 均有效且字段权限不重叠', () => {
  const specs = getPublicOperationSpecs();
  assert.deepEqual(specs.map((item) => item.id), ['generate', 'regenerate_titles', 'regenerate_body', 'polish', 'custom_modify']);
  for (const spec of specs) {
    assert.equal(validateOperationSpec(spec), true);
    assert.deepEqual(spec.writableFields.filter((field) => spec.preservedFields.includes(field)), []);
  }
});

test('非授权字段即使被候选结果修改也会强制恢复', async () => {
  const output = await executeContentOperation(request('regenerate_body'), {
    candidateGenerator: async () => ({ ...currentResult, titleCandidates: ['越权标题'], summary: '越权摘要', topics: ['越权话题'], bodyMarkdown: '这是新的正文。' }),
  });
  assert.equal(output.status, 'completed');
  assert.deepEqual(output.result.titleCandidates, currentResult.titleCandidates);
  assert.equal(output.result.summary, currentResult.summary);
  assert.deepEqual(output.result.topics, currentResult.topics);
  assert.equal(output.result.bodyMarkdown, '这是新的正文。');
  assert.deepEqual(output.result.qualityReport.operationQuality.unauthorizedChangedFields.sort(), ['summary', 'titleCandidates', 'topics']);
});

test('changeSet 只记录真实变化并包含前后哈希', () => {
  const changeSet = createChangeSet(currentResult, { ...currentResult, bodyMarkdown: '新的正文' });
  assert.deepEqual(changeSet.changedFields, ['bodyMarkdown']);
  assert.equal(changeSet.beforeHash, hashContent(currentResult.bodyMarkdown));
  assert.equal(changeSet.afterHash, hashContent('新的正文'));
  assert.equal(changeSet.fields.bodyMarkdown.afterLength, 4);
});

test('第一轮无变化时内部重试，第二轮有效变化后完成', async () => {
  let calls = 0;
  const output = await executeContentOperation(request('regenerate_titles'), {
    candidateGenerator: async () => {
      calls += 1;
      return { ...currentResult, titleCandidates: calls === 1 ? currentResult.titleCandidates : ['新的标题'] };
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(output.result.titleCandidates, ['新的标题']);
  assert.equal(output.result.attempts.total, 2);
  assert.equal(output.result.bodyMarkdown, currentResult.bodyMarkdown);
});

test('选区润色只替换选区，标题、摘要和话题保持不变', async () => {
  const selectedText = '第二段需要润色';
  const start = currentResult.bodyMarkdown.indexOf(selectedText);
  const output = await executeContentOperation(request('polish', {
    scope: 'selection',
    preset: 'natural',
    selection: { start, end: start + selectedText.length, selectedText },
  }), {
    rewriteClient: async () => ({ bodyMarkdown: '第二段表达更自然' }),
  });
  assert.equal(output.result.bodyMarkdown, '第一段需要保留。\n\n在当今快速发展的时代，第二段表达更自然。');
  assert.deepEqual(output.result.titleCandidates, currentResult.titleCandidates);
  assert.equal(output.result.summary, currentResult.summary);
  assert.deepEqual(output.result.topics, currentResult.topics);
});

test('正文哈希过期时返回 CONTENT_STALE，不调用内容生成器', async () => {
  let called = false;
  await assert.rejects(executeContentOperation(request('polish', { bodyHash: hashContent('旧正文') }), {
    candidateGenerator: async () => { called = true; return currentResult; },
  }), (error) => error.code === 'CONTENT_STALE' && error.status === 409);
  assert.equal(called, false);
});

test('custom_modify 先解析目标字段，不默认获得全部字段权限', () => {
  const titleSpec = getOperationSpec('custom_modify', ['titleCandidates', 'selectedTitleIndex']);
  assert.deepEqual(titleSpec.writableFields, ['titleCandidates', 'selectedTitleIndex']);
  assert.ok(titleSpec.preservedFields.includes('bodyMarkdown'));
  assert.throws(() => getOperationSpec('custom_modify', []), /无法确定/);
});

let server;
let baseUrl;
let previousModelMode;
before(async () => {
  previousModelMode = process.env.CONTENTFLOW_MODEL_MODE;
  process.env.CONTENTFLOW_MODEL_MODE = 'local';
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (previousModelMode === undefined) delete process.env.CONTENTFLOW_MODEL_MODE;
  else process.env.CONTENTFLOW_MODEL_MODE = previousModelMode;
});

test('已有正文即使 taskId 过期仍可继续润色', async () => {
  const response = await fetch(`${baseUrl}/api/content-operations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request('polish', { taskId: 'missing-task', preset: 'de_ai' })),
  });
  const output = await response.json();
  assert.equal(response.status, 200);
  assert.equal(output.status, 'completed');
  assert.equal(output.operation, 'polish');
  assert.notEqual(output.result.bodyMarkdown, currentResult.bodyMarkdown);
});

test('首次生成的 taskId 过期仍返回 TASK_NOT_FOUND', async () => {
  const response = await fetch(`${baseUrl}/api/content-operations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'generate', taskId: 'missing-task', platform: 'generic' }),
  });
  const output = await response.json();
  assert.equal(response.status, 404);
  assert.equal(output.code, 'TASK_NOT_FOUND');
});

test('SSE 流式接口依次返回 started、delta、verifying、completed', async () => {
  const response = await fetch(`${baseUrl}/api/content-operations/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request('polish', { preset: 'de_ai' })),
  });
  assert.equal(response.status, 200);
  const text = await response.text();
  const events = [...text.matchAll(/^event: (.+)$/gm)].map((match) => match[1]);
  assert.equal(events[0], 'started');
  assert.ok(events.includes('delta'));
  assert.ok(events.indexOf('verifying') > events.indexOf('delta'));
  assert.ok(events.indexOf('completed') > events.indexOf('verifying'));
  assert.match(text, /AI|operationId/);
});
