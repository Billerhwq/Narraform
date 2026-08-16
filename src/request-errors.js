export const STRATEGY_GENERATION_ERROR = 'strategy-generation';

export function requestErrorMessage(status, fallback = '') {
  if (status === 0 || [502, 503, 504].includes(status)) return '创作服务暂时未连接，请稍后重试';
  return fallback || '处理失败，请重试';
}

export function replaceScopedError(messages, { scope, text, id }) {
  return [
    ...messages.filter((message) => message.type !== 'error' || message.errorScope !== scope),
    { role: 'assistant', type: 'error', errorScope: scope, text, id },
  ];
}

export function clearScopedError(messages, scope) {
  return messages.filter((message) => message.type !== 'error' || message.errorScope !== scope);
}
