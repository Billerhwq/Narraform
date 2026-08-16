import assert from 'node:assert/strict';
import test from 'node:test';
import { clearScopedError, replaceScopedError, requestErrorMessage } from '../src/request-errors.js';

test('网关或服务不可用时返回面向用户的明确说明', () => {
  assert.equal(requestErrorMessage(502, '处理失败'), '创作服务暂时未连接，请稍后重试');
  assert.equal(requestErrorMessage(0, 'Failed to fetch'), '创作服务暂时未连接，请稍后重试');
  assert.equal(requestErrorMessage(500, '内容处理暂时没有完成'), '内容处理暂时没有完成');
});

test('同一操作的错误只保留最新一条', () => {
  const first = replaceScopedError([], { scope: 'strategy', text: '第一次失败', id: 'one' });
  const second = replaceScopedError(first, { scope: 'strategy', text: '第二次失败', id: 'two' });
  assert.equal(second.length, 1);
  assert.equal(second[0].text, '第二次失败');
  assert.deepEqual(clearScopedError(second, 'strategy'), []);
});
