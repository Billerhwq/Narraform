import test from 'node:test';
import assert from 'node:assert/strict';
import { getContent, getContentVersions, resetStore, restoreContentVersion, saveContent } from '../server/store.js';

test.beforeEach(async () => resetStore());

test('PR-01 内容版本使用单调 revision 并拒绝过期保存', async () => {
  const first = await saveContent({
    name: 'CodeLoop 产品介绍',
    platform: 'xiaohongshu',
    titleCandidates: ['第一版标题'],
    bodyMarkdown: '第一版正文',
    topics: ['AI编程'],
  });
  assert.equal(first.revision, 1);
  assert.equal(first.versions[0].revision, 1);

  const second = await saveContent({
    id: first.id,
    baseRevision: 1,
    name: first.name,
    platform: 'xiaohongshu',
    titleCandidates: ['第二版标题'],
    bodyMarkdown: '第二版正文',
    topics: ['AI编程'],
  });
  assert.equal(second.revision, 2);
  await assert.rejects(
    () => saveContent({ id: first.id, baseRevision: 1, platform: 'xiaohongshu', bodyMarkdown: '过期覆盖' }),
    (error) => error.code === 'CONTENT_REVISION_CONFLICT' && error.status === 409,
  );
  assert.equal((await getContent(first.id)).versions.at(-1).bodyMarkdown, '第二版正文');
});

test('PR-01 恢复历史版本会创建新版本而不是覆盖历史', async () => {
  const first = await saveContent({ platform: 'generic', titleCandidates: [], bodyMarkdown: '原始版本' });
  const second = await saveContent({ id: first.id, baseRevision: 1, platform: 'generic', bodyMarkdown: '后续版本' });
  const restored = await restoreContentVersion(first.id, first.versions[0].id, second.revision);
  assert.equal(restored.revision, 3);
  assert.equal(restored.versions.length, 3);
  assert.equal(restored.versions.at(-1).bodyMarkdown, '原始版本');
  assert.equal(restored.versions.at(-1).reason, 'restore');
  assert.equal((await getContentVersions(first.id))[0].revision, 3);
});

test('PR-01 同一内容操作幂等重放不创建重复版本', async () => {
  const first = await saveContent({ platform: 'xiaohongshu', titleCandidates: ['初始标题'], bodyMarkdown: '初始正文' });
  const operationId = 'op_regenerate_body_01';
  const changed = await saveContent({ id: first.id, baseRevision: 1, operationId, operation: 'regenerate_body', platform: 'xiaohongshu', titleCandidates: ['初始标题'], bodyMarkdown: '改写后的正文' });
  assert.equal(changed.revision, 2);
  const replay = await saveContent({ id: first.id, baseRevision: 1, operationId, operation: 'regenerate_body', platform: 'xiaohongshu', titleCandidates: ['初始标题'], bodyMarkdown: '不应产生的新正文' });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.revision, 2);
  assert.equal(replay.versions.length, 2);
  assert.equal(replay.versions.at(-1).bodyMarkdown, '改写后的正文');
});
