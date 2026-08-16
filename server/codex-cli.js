import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LIMIT = 256 * 1024;
const DISABLED_FEATURES = [
  'apps', 'plugins', 'remote_plugin', 'multi_agent', 'hooks',
  'browser_use', 'browser_use_external', 'computer_use', 'in_app_browser',
  'shell_tool', 'image_generation', 'view_image', 'workspace_dependencies',
  'skill_search', 'tool_suggest', 'auth_elicitation',
];

export const CODEX_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['titleCandidates', 'summary', 'bodyMarkdown', 'topics'],
  properties: {
    titleCandidates: { type: 'array', maxItems: 3, items: { type: 'string' } },
    summary: { type: ['string', 'null'] },
    bodyMarkdown: { type: 'string' },
    topics: { type: 'array', maxItems: 8, items: { type: 'string' } },
  },
};

export class CodexCliError extends Error {
  constructor(message, code, options = {}) {
    super(message, options);
    this.name = 'CodexCliError';
    this.code = code;
  }
}

function winTarget() {
  return process.arch === 'arm64' ? ['codex-win32-arm64', 'aarch64-pc-windows-msvc'] : ['codex-win32-x64', 'x86_64-pc-windows-msvc'];
}

function launcherCandidates(env = process.env) {
  const candidates = [];
  if (env.CONTENTFLOW_CODEX_PATH) candidates.push({ command: env.CONTENTFLOW_CODEX_PATH, args: [] });

  if (process.platform === 'win32') {
    const [packageName, target] = winTarget();
    if (env.APPDATA) {
      const npmRoot = path.join(env.APPDATA, 'npm');
      candidates.push({
        command: path.join(npmRoot, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', packageName, 'vendor', target, 'bin', 'codex.exe'),
        args: [],
      });
      candidates.push({ command: process.execPath, args: [path.join(npmRoot, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')] });
    }
    for (const entry of (env.PATH || '').split(path.delimiter).filter(Boolean)) {
      candidates.push({ command: path.join(entry.replace(/^"|"$/g, ''), 'codex.exe'), args: [] });
    }
  } else {
    for (const entry of (env.PATH || '').split(path.delimiter).filter(Boolean)) {
      candidates.push({ command: path.join(entry, 'codex'), args: [] });
    }
  }
  return candidates;
}

async function isExecutable(file) {
  try {
    await access(file, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveCodexLauncher(env = process.env) {
  for (const candidate of launcherCandidates(env)) {
    if (await isExecutable(candidate.command) && candidate.args.every(existsSync)) return candidate;
  }
  return null;
}

export function runCodexProcess(launcher, args, { cwd, input = '', signal, timeoutMs = 10_000, outputLimit = DEFAULT_OUTPUT_LIMIT } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    const child = spawn(launcher.command, [...launcher.args, ...args], {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortHandler);
      if (error) reject(error); else resolve(value);
    };
    const stop = () => {
      if (!child.killed) child.kill('SIGTERM');
    };
    const abortHandler = () => { aborted = true; stop(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);

    signal?.addEventListener('abort', abortHandler, { once: true });
    if (signal?.aborted) abortHandler();
    child.on('error', (error) => finish(new CodexCliError('无法启动本机 Codex CLI', 'SPAWN_FAILED', { cause: error })));
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length + stderr.length > outputLimit) stop();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stdout.length + stderr.length > outputLimit) stop();
    });
    child.on('close', (code) => {
      if (aborted) return finish(new CodexCliError('Codex 生成已取消', 'ABORTED'));
      if (timedOut) return finish(new CodexCliError('Codex 生成超时', 'TIMEOUT'));
      if (stdout.length + stderr.length > outputLimit) return finish(new CodexCliError('Codex 输出超过安全限制', 'OUTPUT_LIMIT'));
      if (code !== 0) return finish(new CodexCliError('本机 Codex CLI 调用失败', 'EXEC_FAILED'));
      finish(null, { stdout, stderr });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

let statusPromise;

export async function detectCodexCli({ env = process.env, refresh = false } = {}) {
  if (!refresh && statusPromise) return statusPromise;
  statusPromise = (async () => {
    const mode = env.CONTENTFLOW_MODEL_MODE || 'deepseek';
    const enabled = mode !== 'local' && env.CONTENTFLOW_CODEX_ENABLED !== '0' && (env.CONTENTFLOW_CODEX_ENABLED === '1' || mode === 'codex');
    const disabled = !enabled;
    const launcher = await resolveCodexLauncher(env);
    const codexHome = env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const configured = existsSync(path.join(codexHome, 'config.toml'));
    if (!launcher) return { detected: false, configured, enabled: !disabled, status: disabled ? 'disabled' : 'not_found', version: null };
    let version = null;
    try {
      const result = await runCodexProcess(launcher, ['--version'], { timeoutMs: 8_000, outputLimit: 16 * 1024 });
      version = result.stdout.trim().replace(/^codex-cli\s+/i, '') || null;
    } catch {
      return { detected: true, configured, enabled: !disabled, status: disabled ? 'disabled' : 'unavailable', version: null };
    }
    return { detected: true, configured, enabled: !disabled, status: disabled ? 'disabled' : 'ready', version };
  })();
  return statusPromise;
}

export function parseCodexOutput(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new CodexCliError('Codex 没有返回有效的结构化文案', 'INVALID_OUTPUT');
  let output;
  try { output = JSON.parse(cleaned.slice(start, end + 1)); } catch (error) {
    throw new CodexCliError('Codex 返回的文案格式无效', 'INVALID_OUTPUT', { cause: error });
  }
  if (!Array.isArray(output.titleCandidates) || !Array.isArray(output.topics) || typeof output.bodyMarkdown !== 'string' || !(typeof output.summary === 'string' || output.summary === null)) {
    throw new CodexCliError('Codex 返回的文案字段不完整', 'INVALID_OUTPUT');
  }
  return output;
}

export async function callCodex(prompt, { signal, runner = runCodexProcess, launcher: suppliedLauncher } = {}) {
  const mode = process.env.CONTENTFLOW_MODEL_MODE || 'deepseek';
  const enabled = mode !== 'local' && process.env.CONTENTFLOW_CODEX_ENABLED !== '0' && (process.env.CONTENTFLOW_CODEX_ENABLED === '1' || mode === 'codex');
  if (!enabled) return null;
  const launcher = suppliedLauncher || await resolveCodexLauncher();
  if (!launcher) return null;

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'contentflow-codex-'));
  const schemaPath = path.join(tempDir, 'output-schema.json');
  const outputPath = path.join(tempDir, 'last-message.json');
  try {
    await writeFile(schemaPath, JSON.stringify(CODEX_OUTPUT_SCHEMA), { encoding: 'utf8', mode: 0o600 });
    const args = [
      'exec', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '--ignore-rules', '--color', 'never',
      '--output-schema', schemaPath, '--output-last-message', outputPath, '-C', tempDir,
      '-c', 'mcp_servers={}',
    ];
    for (const feature of DISABLED_FEATURES) args.push('--disable', feature);
    const reasoningEffort = process.env.CONTENTFLOW_CODEX_REASONING_EFFORT;
    if (['low', 'medium', 'high', 'xhigh'].includes(reasoningEffort)) args.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
    args.push('-');
    await runner(launcher, args, {
      cwd: tempDir,
      input: prompt,
      signal,
      timeoutMs: Number(process.env.CONTENTFLOW_CODEX_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
      outputLimit: Number(process.env.CONTENTFLOW_CODEX_OUTPUT_LIMIT || DEFAULT_OUTPUT_LIMIT),
    });
    return parseCodexOutput(await readFile(outputPath, 'utf8'));
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
