import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { CodexCliError, detectCodexCli, parseCodexOutput, runCodexProcess } from '../server/codex-cli.js';

test('解析 Codex 结构化输出并拒绝不完整字段', () => {
  const parsed = parseCodexOutput('```json\n{"titleCandidates":["标题"],"summary":null,"bodyMarkdown":"正文","topics":[]}\n```');
  assert.equal(parsed.bodyMarkdown, '正文');
  assert.throws(() => parseCodexOutput('{"bodyMarkdown":"正文"}'), (error) => error instanceof CodexCliError && error.code === 'INVALID_OUTPUT');
});

test('CLI 检测只返回公开状态，不暴露配置和认证内容', async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), 'contentflow-empty-home-'));
  try {
    const status = await detectCodexCli({
      refresh: true,
      env: { ...process.env, CONTENTFLOW_CODEX_PATH: process.execPath, CODEX_HOME: codexHome, CONTENTFLOW_MODEL_MODE: 'codex' },
    });
    assert.equal(status.detected, true);
    assert.equal(status.status, 'ready');
    assert.match(status.version, /^v?\d+/);
    assert.deepEqual(Object.keys(status).sort(), ['configured', 'detected', 'enabled', 'status', 'version']);
    assert.doesNotMatch(JSON.stringify(status), /auth\.json|api[_-]?key|config\.toml/i);
  } finally { await rm(codexHome, { recursive: true, force: true }); }
});

test('Codex 子进程支持超时', async () => {
  await assert.rejects(
    runCodexProcess({ command: process.execPath, args: [] }, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 30 }),
    (error) => error instanceof CodexCliError && error.code === 'TIMEOUT',
  );
});

test('Codex 子进程支持 AbortSignal 取消', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(
    runCodexProcess({ command: process.execPath, args: [] }, ['-e', 'setTimeout(() => {}, 5000)'], { signal: controller.signal, timeoutMs: 5000 }),
    (error) => error instanceof CodexCliError && error.code === 'ABORTED',
  );
});

test('Codex 子进程限制输出大小', async () => {
  await assert.rejects(
    runCodexProcess({ command: process.execPath, args: [] }, ['-e', 'process.stdout.write("x".repeat(20000))'], { outputLimit: 1024 }),
    (error) => error instanceof CodexCliError && error.code === 'OUTPUT_LIMIT',
  );
});
