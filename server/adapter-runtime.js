import crypto from 'node:crypto';
import { listEntities, putEntity } from './roadmap-store.js';

const circuits = new Map();
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_RESET_MS = 60_000;

function now() { return new Date().toISOString(); }

function classifyError(error) {
  if (error?.code) return error.code;
  if (error?.name === 'TimeoutError' || /timeout|超时/i.test(error?.message || '')) return 'ADAPTER_TIMEOUT';
  return 'ADAPTER_FAILED';
}

async function record(event) {
  const runtimeEvent = {
    eventId: `evt_${crypto.randomUUID()}`,
    at: now(),
    ...event,
  };
  await putEntity('runtimeEvents', runtimeEvent, 'eventId');
  return runtimeEvent;
}

function circuitFor(key) {
  if (!circuits.has(key)) circuits.set(key, { failures: 0, openedAt: null });
  return circuits.get(key);
}

export async function runAdapterOperation({
  adapterKey,
  action,
  adapterVersion = 'unknown',
  operationId = `op_${crypto.randomUUID()}`,
  failureThreshold = DEFAULT_FAILURE_THRESHOLD,
  resetMs = DEFAULT_RESET_MS,
  execute,
}) {
  const circuit = circuitFor(adapterKey);
  if (circuit.openedAt && Date.now() - circuit.openedAt < resetMs) {
    const error = new Error('外部服务暂时不可用，请稍后重试');
    error.code = 'ADAPTER_CIRCUIT_OPEN';
    error.status = 503;
    await record({ type: 'adapter.blocked', operationId, adapterKey, adapterVersion, action, errorCode: error.code });
    throw error;
  }
  if (circuit.openedAt) {
    circuit.openedAt = null;
    circuit.failures = 0;
  }

  const startedAt = performance.now();
  await record({ type: 'adapter.started', operationId, adapterKey, adapterVersion, action });
  try {
    const result = await execute();
    circuit.failures = 0;
    circuit.openedAt = null;
    await record({
      type: 'adapter.completed',
      operationId,
      adapterKey,
      adapterVersion,
      action,
      durationMs: Math.round(performance.now() - startedAt),
      verificationMethod: result?.verificationMethod || null,
    });
    return result;
  } catch (error) {
    if (error?.code === 'DELIVERY_CANCELLED' || error?.code === 'ABORTED' || error?.name === 'AbortError') {
      await record({
        type: 'adapter.cancelled',
        operationId,
        adapterKey,
        adapterVersion,
        action,
        durationMs: Math.round(performance.now() - startedAt),
      });
      throw error;
    }
    circuit.failures += 1;
    if (circuit.failures >= failureThreshold) circuit.openedAt = Date.now();
    await record({
      type: 'adapter.failed',
      operationId,
      adapterKey,
      adapterVersion,
      action,
      durationMs: Math.round(performance.now() - startedAt),
      errorCode: classifyError(error),
      circuitState: circuit.openedAt ? 'open' : 'closed',
    });
    throw error;
  }
}

export async function listRuntimeEvents({ limit = 200, type, adapterKey } = {}) {
  const values = (await listEntities('runtimeEvents'))
    .filter((event) => !type || event.type === type)
    .filter((event) => !adapterKey || event.adapterKey === adapterKey)
    .sort((a, b) => b.at.localeCompare(a.at));
  return values.slice(0, Math.max(1, Math.min(1000, Number(limit) || 200)));
}

export function getCircuitStatus(adapterKey) {
  const state = circuitFor(adapterKey);
  return {
    adapterKey,
    state: state.openedAt && Date.now() - state.openedAt < DEFAULT_RESET_MS ? 'open' : 'closed',
    failures: state.failures,
    openedAt: state.openedAt ? new Date(state.openedAt).toISOString() : null,
  };
}

export function resetAdapterRuntime() {
  circuits.clear();
}
