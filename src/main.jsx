import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Sender } from '@ant-design/x';
import { Button as AntButton, ConfigProvider, Dropdown as AntDropdown } from 'antd';
import { Alert, Button, Drawer, Input, Message, Modal, Radio, Space, Spin, Tag, Tooltip, Trigger } from '@arco-design/web-react';
import {
  IconAttachment, IconBulb, IconCheck, IconCheckCircleFill, IconClose, IconCopy,
  IconDelete, IconEdit, IconExclamationCircleFill, IconFile, IconHistory, IconHome,
  IconInfoCircleFill, IconLink, IconMenu, IconMore, IconPlus, IconRefresh, IconRobot, IconDown,
  IconUpload, IconUser, IconStop, IconBrush,
  IconFolder, IconSend, IconExperiment,
} from '@arco-design/web-react/icon';
import { SiZhihu } from 'react-icons/si';
import { SocialIcon } from 'react-social-icons';
import '@arco-design/web-react/dist/css/arco.css';
import './styles.css';
import { clearScopedError, replaceScopedError, requestErrorMessage, STRATEGY_GENERATION_ERROR } from './request-errors.js';
import { RichTextEditor } from './rich-text-editor.jsx';
import { formatTime, Header, HistoryPage, ProductNav } from './app-shell.jsx';
import { MaterialsDrawer, QualityDrawer, VersionsDrawer } from './content-drawers.jsx';

const MaterialsWorkspace = lazy(() => import('./roadmap-pages.jsx').then((module) => ({ default: module.MaterialsWorkspace })));
const PublishWorkspace = lazy(() => import('./roadmap-pages.jsx').then((module) => ({ default: module.PublishWorkspace })));
const ReviewWorkspace = lazy(() => import('./roadmap-pages.jsx').then((module) => ({ default: module.ReviewWorkspace })));

const TextArea = Input.TextArea;
const DRAFT_KEY = 'contentflow-v1-draft';
const PREF_KEY = 'contentflow-v1-preferences';
const CHAT_CLEAR_MARKER = 'contentflow-chat-cleared-20260815';
const MATERIAL_SET_KEY = 'narraform-active-material-set';

const platformOptions = [
  { label: '小红书', value: 'xiaohongshu', network: 'xiaohongshu', color: '#ff2442' },
  { label: '知乎', value: 'zhihu', icon: SiZhihu, color: '#1772f6' },
  { label: '公众号', value: 'wechat', network: 'wechat', color: '#07c160' },
  { label: '通用文案', value: 'generic', icon: IconEdit, color: '#5f6670' },
];
const expressionModes = [
  {
    id: 'smart',
    label: '智能匹配',
    structure: '根据平台、受众和内容类型自动选择',
    tone: '智能匹配：根据平台、受众、内容类型和已确认事实选择最合适的表达结构；保持自然克制，不套用固定模板',
  },
  {
    id: 'owner',
    label: '主理人讲产品',
    structure: '为什么做 → 核心能力 → 适用边界',
    tone: '主理人讲产品：以产品团队或创作者视角，从为什么做、核心能力、适合谁和适用边界展开；不伪装第三方测评或用户亲历',
  },
  {
    id: 'friend',
    label: '朋友式分享',
    structure: '具体场景 → 实际价值 → 适合谁',
    tone: '朋友式分享：使用自然口语和短句，从具体且有事实依据的场景切入，再说明实际价值和适合人群；不夸张、不虚构体验',
  },
  {
    id: 'guide',
    label: '干货拆解',
    structure: '问题 → 方法 → 步骤 → 注意事项',
    tone: '干货拆解：按问题、方法、步骤和注意事项组织内容，信息密度优先，避免空泛口号',
  },
  {
    id: 'expert',
    label: '专业解读',
    structure: '先给判断 → 解释依据 → 补充限制',
    tone: '专业解读：先给判断，再解释依据、适用条件和限制；语言准确克制，避免术语堆砌',
  },
  {
    id: 'opinion',
    label: '观点短评',
    structure: '明确立场 → 事实论证 → 给出结论',
    tone: '观点短评：明确立场，用已确认事实和逻辑论证，回应可能的反例或边界，结尾给出清晰结论',
  },
];
const platformFeelOptions = [
  { id: 'auto', label: '自动', description: '根据内容自动选择', rhythm: [10, 7, 4] },
  { id: 'restrained', label: '克制', description: '少表情，信息优先', rhythm: [10, 9, 8] },
  { id: 'natural', label: '自然', description: '短段落，轻口语', rhythm: [9, 6, 8] },
  { id: 'active', label: '活跃', description: '节奏更明快', rhythm: [6, 10, 5] },
];
const legacyToneModes = {
  '自然、专业': 'smart',
  '自然专业': 'smart',
  '轻松口语': 'friend',
  '简洁直接': 'guide',
  '有观点': 'opinion',
};
const quickStarts = ['写一篇产品介绍', '把这段文字改自然', '写一条活动推广文案', '根据资料写知乎回答'];
const topicEditorOptions = {
  xiaohongshu: { label: '话题', itemLabel: '话题', placeholder: '添加小红书话题', limit: 8, marker: '#', includeInCopy: true },
  zhihu: { label: '关联话题', itemLabel: '话题', placeholder: '添加知乎话题', limit: 5, marker: '', includeInCopy: false },
  wechat: { label: '文章标签', itemLabel: '标签', placeholder: '添加公众号文章标签', limit: 5, marker: '', includeInCopy: false },
  generic: { label: '关键词', itemLabel: '关键词', placeholder: '添加内容关键词', limit: 8, marker: '', includeInCopy: false },
};

function expressionModeById(id) {
  return expressionModes.find((mode) => mode.id === id) || expressionModes[0];
}

function resolveExpressionModeId(tone = '') {
  if (legacyToneModes[tone]) return legacyToneModes[tone];
  const exact = expressionModes.find((mode) => mode.tone === tone || mode.label === tone);
  if (exact) return exact.id;
  if (/主理人|产品团队/.test(tone)) return 'owner';
  if (/朋友|口语|轻松/.test(tone)) return 'friend';
  if (/干货|拆解|简洁|步骤/.test(tone)) return 'guide';
  if (/专业|解读|依据/.test(tone)) return 'expert';
  if (/观点|立场|短评/.test(tone)) return 'opinion';
  return 'smart';
}

function normalizeExpressionTone(tone) {
  return expressionModeById(resolveExpressionModeId(tone)).tone;
}

function recommendExpressionModes({ platform, prompt = '', taskBrief, result }) {
  const source = [prompt, taskBrief?.instruction, taskBrief?.contentType, result?.strategySnapshot?.contentType, ...(result?.titleCandidates || []), result?.bodyMarkdown].filter(Boolean).join('\n');
  const contentType = taskBrief?.contentType || result?.strategySnapshot?.contentType || '';
  // A confirmed content type is stronger evidence than incidental words in a generated draft.
  const infer = (type, pattern) => contentType === type || (!contentType && pattern.test(source));
  const product = infer('product_marketing', /(?:产品|功能|工具|应用|服务|品牌|主理人)/);
  const tutorial = infer('tutorial', /(?:教程|攻略|步骤|怎么|如何|方法|操作)/);
  const opinion = infer('opinion', /(?:观点|看法|为什么|是否|趋势|分析|判断)/);
  const release = infer('release_update', /(?:更新|上新|新版本|发布)/);
  const scores = { owner: 1, friend: 1, guide: 1, expert: 1, opinion: 1 };
  if (platform === 'xiaohongshu') { scores.friend += 3; scores.owner += 2; scores.guide += 1; }
  if (platform === 'zhihu') { scores.expert += 3; scores.opinion += 3; scores.guide += 1; }
  if (platform === 'wechat') { scores.expert += 2; scores.guide += 2; scores.owner += 1; }
  if (platform === 'generic') { scores.expert += 1; scores.owner += 1; }
  if (product) { scores.owner += 5; scores.friend += 2; scores.expert += 1; }
  if (tutorial) { scores.guide += 5; scores.friend += 1; }
  if (opinion) { scores.opinion += 5; scores.expert += 2; }
  if (release) { scores.owner += 4; scores.expert += 2; }
  const eligible = expressionModes.filter((mode) => mode.id !== 'smart' && (product || mode.id !== 'owner'));
  const ranked = eligible.sort((a, b) => scores[b.id] - scores[a.id] || expressionModes.indexOf(a) - expressionModes.indexOf(b));
  return [expressionModes[0], ...ranked.slice(0, 4)];
}

function useMobileViewport() {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 620px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 620px)');
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return mobile;
}

const normalizeTopic = (value) => String(value ?? '').replace(/^#+/, '').trim();
const normalizeTopics = (values = [], limit = 8) => [...new Set(values.map(normalizeTopic).filter(Boolean))].slice(0, limit);

function suggestXhsTopics(result = {}) {
  const existing = normalizeTopics(result.topics, 8);
  if (existing.length >= 3) return existing;
  const source = [result.strategySnapshot?.valueProposition?.capability, ...(result.titleCandidates || []), result.bodyMarkdown].filter(Boolean).join('\n');
  const productName = source.match(/产品名是\s*([A-Za-z0-9\u4e00-\u9fa5_-]{2,24})/)?.[1];
  const signals = [
    ['AI求职', /(?:AI|人工智能).{0,6}求职|求职.{0,6}(?:AI|人工智能)/i],
    ['简历投递', /简历.{0,6}投递|投递.{0,6}简历/],
    ['内容创作', /内容.{0,6}(?:创作|生成)|(?:创作|生成).{0,6}内容/],
    ['营销文案', /营销.{0,6}文案|文案.{0,6}营销/],
    ['小红书运营', /小红书/],
    ['多平台创作', /多平台|跨平台/],
    ['AI开发', /(?:AI|人工智能).{0,6}(?:开发|编程)|(?:开发|编程).{0,6}(?:AI|人工智能)/i],
    ['智能体', /智能体|\bagent\b/i],
    ['开源项目', /开源|\bopen source\b/i],
    ['自动化工具', /自动化/],
  ];
  const typeFallbacks = {
    product_marketing: ['产品介绍', '实用工具'], tutorial: ['实用教程', '操作指南'], opinion: ['观点分享', '行业观察'],
    case_study: ['案例分析', '实践复盘'], release_update: ['产品更新', '功能上新'], general_article: ['内容分享', '实用方法'],
  };
  const candidates = [...existing, productName, ...signals.filter(([, pattern]) => pattern.test(source)).map(([topic]) => topic), ...(typeFallbacks[result.strategySnapshot?.contentType] || typeFallbacks.general_article)];
  return normalizeTopics(candidates, 8);
}

function clearResolvedTopicIssues(report = {}) {
  const keep = (issue) => !/(?:topics|话题标签|相关的话题)/i.test(issue);
  const blockingErrors = (report.blockingErrors || []).filter(keep);
  const warnings = (report.warnings || []).filter(keep);
  return {
    ...report,
    blockingErrors,
    warnings,
    suggestions: (report.suggestions || []).filter(keep),
    autoRepairIssues: (report.autoRepairIssues || []).filter(keep),
    platformCheck: blockingErrors.length ? report.platformCheck : warnings.length ? 'warning' : 'pass',
    status: blockingErrors.length ? 'blocked' : warnings.length ? 'ready_with_warnings' : 'ready',
  };
}

async function api(path, options = {}) {
  const generationRequest = path === '/api/generate' || path === '/api/modify' || path === '/api/content-operations';
  const maxAttempts = generationRequest ? 2 : 1;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(path, options);
      if (!response.ok) {
        let message = '处理失败，请重试';
        let code = 'REQUEST_FAILED';
        try {
          const payload = await response.json();
          message = payload.error || message;
          code = payload.code || code;
        } catch { /* noop */ }
        const error = new Error(requestErrorMessage(response.status, message));
        error.code = code;
        error.status = response.status;
        error.retryable = response.status >= 500;
        throw error;
      }
      if (response.status === 204) return null;
      const data = await response.json();
      if (generationRequest && (!data?.result || data.status !== 'completed')) {
        const error = new Error('生成服务没有返回完整文案');
        error.retryable = true;
        throw error;
      }
      return data;
    } catch (error) {
      const normalized = error instanceof TypeError
        ? Object.assign(new Error(requestErrorMessage(0, error.message)), { code: 'SERVICE_UNAVAILABLE', retryable: true })
        : error;
      lastError = normalized;
      if (attempt === maxAttempts || normalized.retryable === false) throw normalized;
      await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    }
  }
  throw lastError;
}

async function sha256(value = '') {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function streamContentOperation(payload, { signal, onEvent }) {
  const response = await fetch('/api/content-operations/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok || !response.body) {
    let message = 'AI 操作启动失败';
    try { message = (await response.json()).error || message; } catch { /* noop */ }
    throw new Error(message);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      const payloadData = JSON.parse(data);
      onEvent(event, payloadData);
      if (event === 'error') {
        const error = new Error(payloadData.error || 'AI 操作失败');
        error.code = payloadData.code;
        throw error;
      }
      if (event === 'completed') return payloadData;
    }
  }
  throw new Error('流式连接提前结束，当前内容未被修改');
}

function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}

function recoverDraftAfterChatClear() {
  const recovered = readLocal(DRAFT_KEY, null);
  try {
    if (localStorage.getItem(CHAT_CLEAR_MARKER) === '1') return recovered;

    if (!recovered) {
      localStorage.setItem(CHAT_CLEAR_MARKER, '1');
      return null;
    }

    const cleaned = {
      ...recovered,
      prompt: '',
      messages: [],
      pendingInstruction: '',
      taskBrief: null,
      selectedStrategyId: null,
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(cleaned));
    localStorage.setItem(CHAT_CLEAR_MARKER, '1');
    return cleaned;
  } catch {
    return recovered;
  }
}

function App() {
  const preferences = readLocal(PREF_KEY, { platform: 'xiaohongshu', tone: expressionModes[0].tone, formattingOverride: { platformFeel: 'auto', emoji: 'auto' } });
  const recovered = recoverDraftAfterChatClear();
  const [section, setSection] = useState('create');
  const [materialSetId, setMaterialSetId] = useState(() => localStorage.getItem(MATERIAL_SET_KEY) || '');
  const [navOpen, setNavOpen] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [prompt, setPrompt] = useState(recovered?.prompt || '');
  const [platform, setPlatform] = useState(recovered?.platform || preferences.platform);
  const [tone, setTone] = useState(() => normalizeExpressionTone(recovered?.tone || preferences.tone));
  const [formattingOverride, setFormattingOverride] = useState(recovered?.formattingOverride || preferences.formattingOverride || { platformFeel: 'auto', emoji: 'auto' });
  const [messages, setMessages] = useState(recovered?.messages || []);
  const [result, setResult] = useState(recovered?.result || null);
  const [contentId, setContentId] = useState(recovered?.contentId || null);
  const [materials, setMaterials] = useState(recovered?.materials || []);
  const [pendingInstruction, setPendingInstruction] = useState(recovered?.pendingInstruction || '');
  const [taskBrief, setTaskBrief] = useState(recovered?.taskBrief || null);
  const [selectedStrategyId, setSelectedStrategyId] = useState(recovered?.selectedStrategyId || null);
  const [generating, setGenerating] = useState(false);
  const [dirty, setDirty] = useState(Boolean(recovered?.dirty));
  const [autosaveState, setAutosaveState] = useState(recovered?.dirty ? 'pending' : 'saved');
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [contents, setContents] = useState([]);
  const [openedContent, setOpenedContent] = useState(null);
  const [activeOperation, setActiveOperation] = useState(null);
  const [operationProgress, setOperationProgress] = useState(null);
  const [streamPreview, setStreamPreview] = useState('');
  const [lastOperation, setLastOperation] = useState(null);
  const [undoSnapshot, setUndoSnapshot] = useState(null);
  const draftTimer = useRef(null);
  const autosaveTimer = useRef(null);
  const contentIdRef = useRef(recovered?.contentId || null);
  const contentRevisionRef = useRef(null);
  const persistQueue = useRef(Promise.resolve());
  const editRevision = useRef(0);
  const [editEpoch, setEditEpoch] = useState(0);
  const legacyTopicRepairs = useRef(new Set());
  const operationController = useRef(null);
  const strategyRequestLock = useRef(false);

  const markDirty = () => {
    editRevision.current += 1;
    setEditEpoch((current) => current + 1);
    setDirty(true);
    setAutosaveState('pending');
  };

  const refreshContents = async () => {
    try { setContents((await api('/api/contents')).contents); } catch (error) { Message.error(error.message); }
  };

  useEffect(() => { refreshContents(); }, []);
  useEffect(() => {
    if (materialSetId) localStorage.setItem(MATERIAL_SET_KEY, materialSetId);
    else localStorage.removeItem(MATERIAL_SET_KEY);
  }, [materialSetId]);
  useEffect(() => { localStorage.setItem(PREF_KEY, JSON.stringify({ platform, tone, formattingOverride })); }, [platform, tone, formattingOverride]);
  useEffect(() => {
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ prompt, platform, tone, formattingOverride, messages, result, contentId, materials, pendingInstruction, taskBrief, selectedStrategyId, dirty }));
    }, 2000);
    return () => clearTimeout(draftTimer.current);
  }, [prompt, platform, tone, formattingOverride, messages, result, contentId, materials, pendingInstruction, taskBrief, selectedStrategyId, dirty]);
  useEffect(() => {
    const warn = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const resetDraft = () => {
    strategyRequestLock.current = false;
    contentIdRef.current = null;
    contentRevisionRef.current = null;
    setPrompt(''); setMessages([]); setResult(null); setContentId(null); setMaterials([]); setMaterialSetId(''); setPendingInstruction(''); setTaskBrief(null); setSelectedStrategyId(null); setDirty(false); setSection('create'); setNavOpen(false);
    setAutosaveState('saved'); setLastSavedAt(null);
    setActiveOperation(null); setOperationProgress(null); setStreamPreview(''); setLastOperation(null); setUndoSnapshot(null);
    localStorage.removeItem(DRAFT_KEY);
  };

  const startNew = () => {
    if (!dirty) return resetDraft();
    Modal.confirm({
      title: '新建文案？',
      content: '自动保存尚未完成。现在新建仍会保留本地草稿，稍等片刻后再操作可直接写入内容记录。',
      okText: '新建文案',
      cancelText: '继续编辑',
      onOk: resetDraft,
    });
  };

  const openSection = (next) => {
    if (next === 'history' && dirty) {
      Modal.confirm({ title: '离开当前文案？', content: '自动保存尚未完成，当前修改已临时保留在本地草稿。', okText: '查看内容记录', onOk: () => { setSection(next); setNavOpen(false); refreshContents(); } });
      return;
    }
    setSection(next); setNavOpen(false); if (next === 'history') refreshContents();
  };

  const submit = async (value = prompt) => {
    const request = value.trim();
    if (!request || generating) return;
    if (result) {
      setMessages((current) => [...current, { role: 'user', text: request, id: crypto.randomUUID() }]);
      setPrompt('');
      await runContentOperation('custom_modify', { instruction: request });
      return;
    }
    const instruction = pendingInstruction
      ? `${pendingInstruction}\n用户补充：${request}`
      : !result && taskBrief?.instruction ? `${taskBrief.instruction}\n用户补充：${request}` : request;
    setMessages((current) => [...current, { role: 'user', text: request, id: crypto.randomUUID() }]);
    setPrompt(''); setGenerating(true);
    try {
      const data = await api('/api/tasks/understand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction, platform, tone, materialIds: materials.map((item) => item.id), materialSetId: materialSetId || undefined }) });
      if (data.status === 'needs_input') {
        setTaskBrief(data.taskBrief || null);
        setSelectedStrategyId(null);
        setPendingInstruction(instruction);
        setMessages((current) => [...current, { role: 'assistant', type: 'question', text: data.questions.join('\n'), id: crypto.randomUUID() }]);
      } else if (data.status === 'awaiting_strategy') {
        setPendingInstruction('');
        setTaskBrief(data.taskBrief);
        setSelectedStrategyId(null);
        setMessages((current) => [...current, { role: 'assistant', type: 'strategy', text: '我整理了 3 个适合这次任务的内容方向。选一个后再生成，你也可以继续补充要求让我重新分析。', id: crypto.randomUUID() }]);
      } else {
        setPendingInstruction('');
        setResult(data.result);
        setMessages((current) => [...current, { role: 'assistant', type: 'result', resultId: data.result.resultId, id: crypto.randomUUID() }]);
        markDirty();
      }
    } catch (error) {
      Message.error(error.message);
      setPrompt(request);
      setMessages((current) => [...current, { role: 'assistant', type: 'error', text: `${error.message}。系统已自动重试，当前内容和输入均已保留。`, id: crypto.randomUUID() }]);
    } finally { setGenerating(false); }
  };

  const selectStrategy = async (strategyId) => {
    if (!taskBrief || generating || strategyRequestLock.current) return;
    strategyRequestLock.current = true;
    setSelectedStrategyId(strategyId); setGenerating(true);
    setMessages((current) => clearScopedError(current, STRATEGY_GENERATION_ERROR));
    try {
      const selected = await api(`/api/tasks/${taskBrief.taskId}/select-strategy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strategyId }) });
      setTaskBrief(selected.taskBrief);
       const data = await api('/api/content-operations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'generate', taskId: taskBrief.taskId, strategyId, platform, tone, formattingOverride, materialIds: materials.map((item) => item.id) }) });
      setResult(data.result);
      setMessages((current) => [...clearScopedError(current, STRATEGY_GENERATION_ERROR), { role: 'assistant', type: 'result', resultId: data.result.resultId, id: crypto.randomUUID() }]);
      markDirty();
    } catch (error) {
      Message.error(error.message);
      const text = `${error.message}。系统已自动尝试恢复，内容方向已保留。`;
      setMessages((current) => replaceScopedError(current, { scope: STRATEGY_GENERATION_ERROR, text, id: crypto.randomUUID() }));
    } finally {
      strategyRequestLock.current = false;
      setGenerating(false);
    }
  };

  const toggleLearningRule = async (ruleId, enabled) => {
    if (!taskBrief || generating) return;
    setGenerating(true);
    try {
      const data = await api(`/api/tasks/${taskBrief.taskId}/learning-rules/${ruleId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
      });
      setTaskBrief(data.taskBrief);
      setSelectedStrategyId(null);
      Message.success(enabled ? '本次创作会参考这条经验' : '本次创作已取消这条经验');
    } catch (error) { Message.error(error.message); }
    finally { setGenerating(false); }
  };

  const persistCurrent = async (reason) => {
    if (!result) return contentIdRef.current;
    const save = async () => {
      const checked = await checkCurrentResult({ trackRepairs: false });
      const selectedTitle = checked.titleCandidates?.[checked.selectedTitleIndex || 0];
      const data = await api('/api/contents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: contentIdRef.current, baseRevision: contentIdRef.current ? contentRevisionRef.current : undefined, name: selectedTitle || '未命名文案', platform, materialIds: materials.map((item) => item.id), materialSetId: materialSetId || undefined, ...checked, reason }) });
      contentIdRef.current = data.content.id;
      contentRevisionRef.current = data.content.revision;
      setContentId(data.content.id); setOpenedContent(data.content); await refreshContents();
      return data.content.id;
    };
    const operation = persistQueue.current.then(save, save);
    persistQueue.current = operation.catch(() => {});
    return operation;
  };

  const persistOperationResult = async (value, id, reason) => {
    const selectedTitle = value.titleCandidates?.[value.selectedTitleIndex || 0];
    const data = await api('/api/contents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, baseRevision: id ? contentRevisionRef.current : undefined, name: selectedTitle || '未命名文案', platform, materialIds: materials.map((item) => item.id), materialSetId: materialSetId || undefined, ...value, reason }),
    });
    contentIdRef.current = data.content.id;
    contentRevisionRef.current = data.content.revision;
    setContentId(data.content.id);
    setOpenedContent(data.content);
    await refreshContents();
    return data.content.id;
  };

  const runContentOperation = async (operation, details = {}) => {
    if (!result || generating || activeOperation) return false;
    const before = structuredClone(result);
    const controller = new AbortController();
    operationController.current = controller;
    setGenerating(true);
    setActiveOperation(operation);
    setOperationProgress('starting');
    setStreamPreview('');
    setLastOperation(null);
    try {
      const savedId = await persistCurrent(`before-${operation}`);
      const bodyHash = await sha256(before.bodyMarkdown || '');
      const payload = {
        operationId: crypto.randomUUID(),
        operation,
        platform,
        platformMode: before.platformMode,
         tone,
         formattingOverride,
        taskId: before.taskId,
        strategyId: before.strategyId,
        materialIds: materials.map((item) => item.id),
        baseInstruction: taskBrief?.instruction || pendingInstruction || '基于当前文案继续优化',
        currentResult: before,
        parentResultId: before.resultId,
        bodyHash,
        contentId: savedId,
        baseRevision: contentRevisionRef.current,
        materialSetId: materialSetId || undefined,
        ...details,
      };
      const data = await streamContentOperation(payload, {
        signal: controller.signal,
        onEvent: (event, eventData) => {
          if (event === 'started') setOperationProgress('generating');
          if (event === 'delta' && eventData.field === 'bodyMarkdown') setStreamPreview((current) => current + eventData.delta);
          if (event === 'verifying') setOperationProgress('verifying');
        },
      });
      setAutosaveState('saving');
      if (data.savedContent) {
        contentIdRef.current = data.savedContent.id;
        contentRevisionRef.current = data.savedContent.revision;
        setContentId(data.savedContent.id);
        const refreshed = await api(`/api/contents/${data.savedContent.id}`);
        setOpenedContent(refreshed.content);
        await refreshContents();
      } else {
        await persistOperationResult(data.result, savedId, operation);
      }
      setUndoSnapshot(before);
      setResult(data.result);
      setLastOperation({ operation, changeSet: data.changeSet, resultId: data.result.resultId });
      setMessages((current) => current.filter((message) => message.type !== 'error'));
      setDirty(false);
      setAutosaveState('saved');
      setLastSavedAt(new Date());
      const message = operation === 'regenerate_titles' ? '已根据当前正文更换标题'
        : operation === 'regenerate_body' ? '已根据当前标题更换正文'
          : operation === 'polish' ? `已润色，调整了 ${data.changeSet.fields.bodyMarkdown?.added?.length || data.changeSet.changedFields.length} 处表达`
            : '已按要求完成修改';
      Message.success(message);
      return true;
    } catch (error) {
      setAutosaveState(dirty ? 'error' : 'saved');
      if (error.name !== 'AbortError' && error.code !== 'ABORTED') Message.error(`${error.message}。当前文案保持不变。`);
      else Message.info('已取消，当前文案没有变化');
      return false;
    } finally {
      operationController.current = null;
      setGenerating(false);
      setActiveOperation(null);
      setOperationProgress(null);
      setStreamPreview('');
    }
  };

  const cancelOperation = () => operationController.current?.abort();
  const quickModify = (modification) => runContentOperation('custom_modify', { instruction: modification });
  const applyExpressionMode = async (modeId, platformFeel = formattingOverride.platformFeel || 'auto') => {
    const mode = expressionModeById(modeId);
    const nextFormatting = { ...formattingOverride, platformFeel };
    if (!result) {
      setTone(mode.tone);
      setFormattingOverride(nextFormatting);
      return true;
    }
    const applied = await runContentOperation('custom_modify', {
      tone: mode.tone,
      formattingOverride: nextFormatting,
      instruction: `按“${mode.label}”和“${platformFeelOptions.find((item) => item.id === platformFeel)?.label || '自动'}平台感”重写当前正文。${mode.tone}。保留已确认事实、标题与话题的语义一致性。`,
    });
    if (applied) { setTone(mode.tone); setFormattingOverride(nextFormatting); }
    return applied;
  };
  const polishContent = (preset, selection = null, instruction = '') => runContentOperation('polish', {
    preset,
    instruction,
    scope: selection?.selectedText ? 'selection' : 'document',
    selection,
  });
  const regeneratePart = (part) => runContentOperation(part === 'titles' ? 'regenerate_titles' : 'regenerate_body');

  const undoLastOperation = async () => {
    if (!undoSnapshot || !result || generating) return;
    const restored = {
      ...undoSnapshot,
      resultId: crypto.randomUUID(),
      parentResultId: result.resultId,
      operation: 'undo',
      operationId: crypto.randomUUID(),
    };
    setResult(restored);
    setLastOperation(null);
    setUndoSnapshot(null);
    markDirty();
    try { setAutosaveState('saving'); await persistOperationResult(restored, contentId, 'undo'); setDirty(false); setAutosaveState('saved'); setLastSavedAt(new Date()); } catch { setAutosaveState('error'); }
    Message.success('已撤销上一次 AI 修改');
  };

  const updateResult = (patch) => {
    const changed = Object.entries(patch).some(([field, value]) => JSON.stringify(result?.[field]) !== JSON.stringify(value));
    if (!changed) return;
    setResult((current) => ({ ...current, ...patch }));
    markDirty();
  };

  const checkCurrentResult = async ({ trackRepairs = true } = {}) => {
    const data = await api('/api/quality', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction: taskBrief?.instruction || pendingInstruction, platform, taskId: result?.taskId, materialIds: materials.map((item) => item.id), result }) });
    const repaired = ['titleCandidates', 'summary', 'bodyMarkdown', 'topics'].some((field) => JSON.stringify(data.result?.[field]) !== JSON.stringify(result?.[field]));
    setResult(data.result);
    if (trackRepairs && repaired) markDirty();
    return data.result;
  };

  useEffect(() => {
    const repairKey = result?.resultId || result?.id;
    if (platform !== 'xiaohongshu' || !repairKey || (result?.topics || []).length >= 3 || legacyTopicRepairs.current.has(repairKey)) return;
    legacyTopicRepairs.current.add(repairKey);
    const topics = suggestXhsTopics(result);
    if (topics.length >= 3) {
      updateResult({ topics, qualityReport: clearResolvedTopicIssues(result.qualityReport) });
      return;
    }
    checkCurrentResult().catch(() => { legacyTopicRepairs.current.delete(repairKey); });
  }, [result?.resultId, result?.id, platform]);

  useEffect(() => {
    clearTimeout(autosaveTimer.current);
    if (!result || !dirty || generating || activeOperation) return undefined;
    const revision = editRevision.current;
    const timer = setTimeout(async () => {
      setAutosaveState('saving');
      try {
        await persistCurrent('autosave');
        if (editRevision.current === revision) {
          setDirty(false);
          setAutosaveState('saved');
          setLastSavedAt(new Date());
        }
      } catch {
        setAutosaveState('error');
      }
    }, 500);
    autosaveTimer.current = timer;
    return () => clearTimeout(timer);
  }, [editEpoch, dirty, generating, activeOperation, platform, materials]);

  const loadContent = async (id) => {
    if (dirty) {
      Modal.confirm({ title: '打开其他文案？', content: '自动保存尚未完成，当前修改会先保留在本地草稿。', onOk: () => loadContentNow(id) });
    } else await loadContentNow(id);
  };

  const loadContentNow = async (id) => {
    try {
      const data = await api(`/api/contents/${id}`); const latest = data.content.versions.at(-1); contentIdRef.current = data.content.id; contentRevisionRef.current = data.content.revision || data.content.versions.length;
      setOpenedContent(data.content); setContentId(data.content.id); setMaterialSetId(data.content.materialSetId || ''); setPlatform(latest.platform); setFormattingOverride(latest.formattingOverride || { platformFeel: 'auto', emoji: 'auto' }); setResult(latest); setTaskBrief(null); setSelectedStrategyId(latest.strategyId || null); setMessages([{ role: 'assistant', type: 'loaded', text: '已打开保存的文案，可以继续编辑或提出修改要求。', id: crypto.randomUUID() }]); setMaterials(data.materials || []); setDirty(false); setAutosaveState('saved'); setLastSavedAt(new Date(data.content.updatedAt)); setSection('create');
    } catch (error) { Message.error(error.message); }
  };

  const deleteRecord = (id) => Modal.confirm({ title: '删除这条内容？', content: '相关版本和附件会一并删除，此操作无法撤销。', okText: '删除', cancelText: '取消', okButtonProps: { status: 'danger' }, onOk: async () => { try { await api(`/api/contents/${id}`, { method: 'DELETE' }); if (id === contentIdRef.current) resetDraft(); await refreshContents(); Message.success('内容已删除'); } catch (error) { Message.error(error.message); throw error; } } });

  const renameRecord = (item) => {
    let name = item.name;
    Modal.confirm({ title: '重命名', content: <Input defaultValue={item.name} onChange={(value) => { name = value; }} />, onOk: async () => { if (!name.trim()) return false; await api(`/api/contents/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); await refreshContents(); } });
  };

  return <div className="app-shell">
    <Header section={section} autosaveState={autosaveState} onMenu={() => setNavOpen(true)} onNew={startNew} />
    <ProductNav active={section} contents={contents} onChange={openSection} onNew={startNew} onOpen={loadContent} onDelete={deleteRecord} />
    <main className={section === 'create' ? 'assistant-workspace' : section === 'history' ? 'user-workspace' : 'roadmap-host'}>
      {section === 'create' ? <CopyAssistant
        messages={messages} result={result} platform={platform} setPlatform={setPlatform} tone={tone} setTone={setTone} formattingOverride={formattingOverride}
        prompt={prompt} setPrompt={setPrompt} materials={materials} removeMaterial={(id) => { setMaterials((items) => items.filter((item) => item.id !== id)); markDirty(); }} toggleLearningRule={toggleLearningRule}
        generating={generating} submit={submit} taskBrief={taskBrief} selectedStrategyId={selectedStrategyId} selectStrategy={selectStrategy} updateResult={updateResult} quickModify={quickModify} regeneratePart={regeneratePart} polishContent={polishContent} dirty={dirty} autosaveState={autosaveState} lastSavedAt={lastSavedAt}
        activeOperation={activeOperation} operationProgress={operationProgress} streamPreview={streamPreview} cancelOperation={cancelOperation} lastOperation={lastOperation} undoLastOperation={undoLastOperation}
        openMaterials={() => setMaterialsOpen(true)} openQuality={async () => { await checkCurrentResult(); setQualityOpen(true); }} openVersions={() => { setVersionsOpen(true); }} contentId={contentId} checkResult={checkCurrentResult} applyExpressionMode={applyExpressionMode}
      /> : section === 'materials' ? <Suspense fallback={<div className="roadmap-loading"><Spin /><span>正在打开素材理解</span></div>}><MaterialsWorkspace materialSetId={materialSetId} onMaterialSetChange={setMaterialSetId} onUseForCreation={(set) => { setMaterialSetId(set.materialSetId); setSection('create'); Message.success('创作时会使用这组已确认资料'); }} /></Suspense>
        : section === 'publish' ? <Suspense fallback={<div className="roadmap-loading"><Spin /><span>正在打开平台发布</span></div>}><PublishWorkspace materialSetId={materialSetId} /></Suspense>
          : section === 'review' ? <Suspense fallback={<div className="roadmap-loading"><Spin /><span>正在打开内容复盘</span></div>}><ReviewWorkspace /></Suspense>
      : <HistoryPage contents={contents} onOpen={loadContent} onNew={startNew} onDelete={deleteRecord} onRename={renameRecord} platformOptions={platformOptions} />}
    </main>
    <Drawer className="nav-drawer" title="Narraform" width={280} placement="left" visible={navOpen} onCancel={() => setNavOpen(false)} footer={null}><ProductNav active={section} contents={contents} onChange={openSection} onNew={startNew} onOpen={loadContent} onDelete={deleteRecord} mobile /></Drawer>
    <MaterialsDrawer visible={materialsOpen} onClose={() => setMaterialsOpen(false)} onOpenWorkspace={() => { setMaterialsOpen(false); setSection('materials'); }} materials={materials} request={api} onAdded={(items) => { setMaterials((current) => [...current, ...items].slice(0, 10)); markDirty(); }} />
    <QualityDrawer visible={qualityOpen} onClose={() => setQualityOpen(false)} result={result} onFix={(warning) => { setQualityOpen(false); quickModify(`修复这项问题，并保持其他内容不变：${warning}`); }} />
    <VersionsDrawer visible={versionsOpen} onClose={() => setVersionsOpen(false)} content={openedContent} current={result} onUse={async (version) => {
      if (!contentIdRef.current) { setResult(version); setPlatform(version.platform); markDirty(); setVersionsOpen(false); return; }
      try {
        const data = await api(`/api/contents/${contentIdRef.current}/versions/${version.id}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': String(contentRevisionRef.current) }, body: JSON.stringify({ baseRevision: contentRevisionRef.current }) });
        contentRevisionRef.current = data.content.revision; setOpenedContent(data.content); setResult(data.version); setPlatform(data.version.platform); setDirty(false); setAutosaveState('saved'); setVersionsOpen(false); await refreshContents(); Message.success('已恢复为新版本');
      } catch (error) { Message.error(error.message); }
    }} />
  </div>;
}

function CopyAssistant(props) {
  const empty = !props.messages.length && !props.result;
  return <section className={`assistant-shell ${empty ? 'is-empty' : ''}`}><div className="conversation">{empty ? <Welcome submit={props.submit} /> : <><div className="assistant-message intro-message"><Avatar /><div className="message-body"><p>把目标和资料告诉我。我会先整理事实并推荐内容方向，等你选择后再按平台生成。</p></div></div>{props.messages.map((message) => <MessageItem key={message.id} message={message} result={props.result} />)}{props.taskBrief?.status !== 'needs_input' && !props.result && <StrategyChooser taskBrief={props.taskBrief} selectedStrategyId={props.selectedStrategyId} loading={props.generating} onSelect={props.selectStrategy} onToggleLearningRule={props.toggleLearningRule} />}{props.result && <ResultEditor {...props} />}{props.generating && <div className="assistant-message"><Avatar /><div className="message-body typing"><i /><i /><i /><span>{props.selectedStrategyId ? '正在按选定方向生成文案' : '正在理解任务和整理事实'}</span></div></div>}</>}</div><Composer {...props} /></section>;
}

function Welcome({ submit }) { return <div className="welcome-state"><div className="welcome-heading"><span className="assistant-avatar large"><IconRobot /></span><div><span className="welcome-kicker">AI 文案助手</span><h1>今天想写什么？</h1></div></div><p>从一个想法开始，或者继续修改已有文字。</p><div className="quick-starts">{quickStarts.map((item) => <button key={item} onClick={() => submit(item)}><IconBulb /><span>{item}</span></button>)}</div></div>; }
function Avatar({ user = false }) { return <span className={user ? 'user-avatar' : 'assistant-avatar'}>{user ? <IconUser /> : <IconRobot />}</span>; }
function MessageItem({ message }) {
  if (message.role === 'user') return <div className="user-message"><div className="message-body"><p>{message.text}</p></div><Avatar user /></div>;
  if (message.type === 'result') return null;
  const icon = message.type === 'error' ? <IconExclamationCircleFill /> : <IconRobot />;
  return <div className={`assistant-message ${message.type || ''}`}><span className="assistant-avatar">{icon}</span><div className="message-body">{message.type === 'question' ? <div className="question-content"><span className="question-kicker"><IconInfoCircleFill />还缺一项信息</span><p>{message.text}</p></div> : <p>{message.text}</p>}</div></div>;
}

function StrategyChooser({ taskBrief, selectedStrategyId, loading, onSelect, onToggleLearningRule }) {
  if (!taskBrief?.strategyOptions?.length) return null;
  const appliedIds = new Set((taskBrief.learningRulesApplied || []).map((item) => item.ruleId));
  return <div className="assistant-message strategy-message"><Avatar /><div className="message-body strategy-panel"><div className="strategy-summary"><div><span className="strategy-kicker">内容方向</span><h2>选择这篇文案怎么切入</h2></div><Tag color="arcoblue">已确认 {taskBrief.facts?.length || 0} 条事实</Tag></div><p className="strategy-context">面向 {taskBrief.strategyOptions[0]?.audience?.label || '目标读者'}，目标是{taskBrief.strategyOptions[0]?.goal || '清楚表达核心信息'}。</p>{taskBrief.learningRulesAvailable?.length ? <div className="strategy-learning-context"><IconExperiment /><div><strong>已确认的创作经验</strong>{taskBrief.learningRulesAvailable.map((rule) => { const applied = appliedIds.has(rule.ruleId); return <span className={`strategy-learning-rule ${applied ? '' : 'is-disabled'}`} key={rule.ruleId}><span>{rule.rule}</span><Button type="text" size="mini" disabled={loading} onClick={() => onToggleLearningRule(rule.ruleId, !applied)}>{applied ? '本次不采用' : '本次采用'}</Button></span>; })}</div></div> : null}<div className="strategy-options">{taskBrief.strategyOptions.map((strategy, index) => {
    const active = selectedStrategyId === strategy.id;
    return <article className={`strategy-option ${active ? 'active' : ''}`} key={strategy.id}><div className="strategy-title"><span>{index + 1}</span><div><h3>{strategy.name}</h3>{index === 0 && <small>推荐</small>}</div></div><p>{strategy.description}</p><dl><div><dt>开头</dt><dd>{strategy.hook}</dd></div><div><dt>核心</dt><dd>{strategy.coreMessage}</dd></div></dl><div className="strategy-footer"><span>{strategy.structure.slice(0, 3).join(' · ')}</span><Button type={index === 0 ? 'primary' : 'secondary'} loading={active && loading} disabled={loading && !active} onClick={() => onSelect(strategy.id)}>用这个方向</Button></div></article>;
  })}</div><small className="strategy-note">受众和目标由系统根据当前信息推断，仅用于组织表达，不会写成调研结论。</small></div></div>;
}

function ResultEditor({ result, platform, updateResult, quickModify, regeneratePart, polishContent, generating, dirty, autosaveState, lastSavedAt, openQuality, openVersions, contentId, checkResult, activeOperation, operationProgress, streamPreview, cancelOperation, lastOperation, undoLastOperation }) {
  const [editingTitleIndex, setEditingTitleIndex] = useState(null);
  const [regeneratingPart, setRegeneratingPart] = useState(null);
  const label = platformOptions.find((item) => item.value === platform)?.label;
  const bodyLength = [...(result.bodyMarkdown || '').replace(/\s/g, '')].length;
  const warnings = result.qualityReport?.warnings || [];
  const titleCount = result.titleCandidates?.length || 0;
  const selectedTitleIndex = Math.min(result.selectedTitleIndex || 0, Math.max(0, titleCount - 1));
  const topicEditor = topicEditorOptions[platform] || topicEditorOptions.generic;
  const topics = normalizeTopics(result.topics, topicEditor.limit);
  const formattingLabel = result.formatting?.label || (platform === 'xiaohongshu' ? '自动匹配' : null);
  const saveState = autosaveState === 'saving' ? '正在自动保存' : autosaveState === 'pending' ? '等待自动保存' : autosaveState === 'error' ? '自动保存失败' : lastSavedAt ? `已自动保存 · ${formatTime(lastSavedAt)}` : '已自动保存';
  const editingState = activeOperation ? operationProgress === 'verifying' ? '正在检查' : '正在改写' : autosaveState === 'saving' ? '正在自动保存' : autosaveState === 'error' ? '自动保存失败' : dirty ? '正在编辑' : '内容已同步';
  const copyText = async () => { const checked = await checkResult(); if (checked.qualityReport?.status === 'blocked') { Message.error('文案还有必须修复的问题，请先查看检查结果'); await openQuality(); return; } const titleIndex = Math.min(checked.selectedTitleIndex || 0, Math.max(0, (checked.titleCandidates?.length || 1) - 1)); const checkedTopics = normalizeTopics(checked.topics, topicEditor.limit); const topicText = topicEditor.includeInCopy && checkedTopics.length ? checkedTopics.map((topic) => `${topicEditor.marker}${topic}`).join(' ') : ''; const text = [checked.titleCandidates?.[titleIndex], checked.summary, checked.bodyMarkdown, topicText].filter(Boolean).join('\n\n'); await navigator.clipboard.writeText(text); Message.success('文案已复制'); };
  const quickActions = [
    { label: '降低营销感', instruction: '降低营销感，删除夸张、催促和空泛表达，不添加新事实', icon: <IconBulb /> },
    { label: '换个开头', instruction: '只重写开头，让切入更具体，后面的核心信息保持不变', icon: <IconEdit /> },
    { label: '补充适用边界', instruction: '补充适用条件和不适用情况，不虚构新事实', icon: <IconInfoCircleFill /> },
  ];
  const handleRegenerate = async (part) => {
    if (generating || regeneratingPart) return;
    setRegeneratingPart(part);
    try { await regeneratePart(part); } finally { setRegeneratingPart(null); }
  };
  const handleTopicsChange = (nextTopics) => {
    const normalized = normalizeTopics(nextTopics, topicEditor.limit);
    const removedNow = topics.filter((topic) => !normalized.includes(topic));
    const removedTopics = [...new Set([...(result.removedTopics || []), ...removedNow])].filter((topic) => !normalized.includes(topic));
    updateResult({ topics: normalized, removedTopics });
  };
  const moreMenu = { items: [{ key: 'rewrite', label: '重新生成整篇', icon: <IconRefresh /> }, ...(contentId ? [{ key: 'versions', label: '查看版本记录', icon: <IconHistory /> }] : [])], onClick: ({ key }) => key === 'versions' ? openVersions() : quickModify('重新写，换一种明显不同的表达') };
  const polishMenu = {
    items: [
      { key: 'de_ai', label: '去 AI 味' },
      { key: 'natural', label: '更自然' },
      { key: 'concise', label: '精简重复' },
      { key: 'logic', label: '优化逻辑' },
      { key: 'platform_tone', label: `贴近${label}风格` },
    ],
    onClick: ({ key }) => polishContent(key),
  };
  const blocked = result.qualityReport?.status === 'blocked';
  const showChangeSet = () => {
    const fields = lastOperation?.changeSet?.fields || {};
    Modal.info({
      title: '本次修改对比',
      className: 'change-set-modal',
      content: <div className="change-set-view">{Object.entries(fields).map(([field, change]) => <section key={field}><strong>{field === 'bodyMarkdown' ? '正文' : field === 'titleCandidates' ? '标题' : field}</strong>{'removed' in change ? <div className="text-diff"><p className="diff-removed">{change.removed || '无删除内容'}</p><p className="diff-added">{change.added || '无新增内容'}</p></div> : <div className="value-diff"><p>{JSON.stringify(change.before)}</p><p>{JSON.stringify(change.after)}</p></div>}</section>)}</div>,
      okText: '关闭',
    });
  };
  return <div className="assistant-message result-message"><Avatar /><article key={result.resultId || 'result'} className="message-body"><header className="result-head"><div className="result-identity"><PlatformBrand value={platform} /><span className="result-identity-copy"><strong>{label}文案</strong><small>可直接编辑的生成结果</small></span>{formattingLabel && <Tag className="formatting-state-tag"><IconBrush />{formattingLabel}</Tag>}<Tag className={`save-state-tag is-${autosaveState}`} icon={autosaveState === 'saving' ? <Spin size={10} /> : autosaveState === 'error' ? <IconExclamationCircleFill /> : autosaveState === 'pending' ? <IconEdit /> : <IconCheck />}>{saveState}</Tag></div><div className="result-status"><span className="result-stat"><b>{titleCount || 1}</b><small>{titleCount ? '个标题' : '份正文'}</small></span><span className="result-stat"><b>{bodyLength}</b><small>字</small></span><Button className={`quality-trigger ${warnings.length ? 'has-warning' : ''} ${blocked ? 'is-blocked' : ''}`} type="secondary" size="small" icon={warnings.length ? <IconExclamationCircleFill /> : <IconCheckCircleFill />} onClick={openQuality}>{blocked ? '需要确认' : warnings.length ? `${warnings.length} 项建议` : '检查通过'}</Button></div></header>
    <div className={`result-workbench ${titleCount ? 'has-titles' : ''}`}>
      {titleCount > 0 && <aside className={`result-title-panel ${regeneratingPart === 'titles' ? 'is-regenerating' : ''}`} aria-busy={regeneratingPart === 'titles'}><Field label="标题方案" extra={<Button className="regenerate-button title-regenerate" type="text" size="mini" icon={<IconRefresh />} loading={regeneratingPart === 'titles'} disabled={generating && regeneratingPart !== 'titles'} aria-label="换一批标题" onClick={() => handleRegenerate('titles')}>换一批</Button>}><Radio.Group className="title-options" value={selectedTitleIndex} onChange={(value) => updateResult({ selectedTitleIndex: value })} aria-label="标题方案">{result.titleCandidates.map((title, index) => { const active = selectedTitleIndex === index; const editing = editingTitleIndex === index; return <div className={`title-choice ${active ? 'active' : ''}`} key={index}><Radio value={index} aria-label={`选择标题 ${index + 1}`} />{editing ? <Input className="title-edit-input" value={title} autoFocus onChange={(value) => { const values = [...result.titleCandidates]; values[index] = value; updateResult({ titleCandidates: values }); }} onBlur={() => setEditingTitleIndex(null)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /> : <button type="button" className="title-choice-text" onClick={() => updateResult({ selectedTitleIndex: index })}>{title}</button>}{active && !editing && <><span className="title-choice-state">当前</span><Tooltip content="编辑这个标题"><Button type="text" size="mini" icon={<IconEdit />} aria-label={`编辑标题 ${index + 1}`} onClick={() => setEditingTitleIndex(index)} /></Tooltip></>}</div>; })}</Radio.Group></Field></aside>}
      <div className={`result-document ${regeneratingPart === 'body' ? 'is-regenerating' : ''}`} aria-busy={regeneratingPart === 'body'}>
        {result.summary != null && <Field label="摘要"><TextArea value={result.summary} onChange={(value) => updateResult({ summary: value })} autoSize={{ minRows: 2, maxRows: 4 }} aria-label="文案摘要" /></Field>}
        <Field className="body-field" label={<span className="body-field-title">正文{titleCount > 0 && <small><IconLink />跟随当前标题</small>}</span>} extra={<span className="field-actions"><span className={`editing-status is-${autosaveState}`} aria-live="polite"><i />{editingState}</span><AntDropdown menu={polishMenu} trigger={['click']} placement="bottomRight"><Button className="polish-button" type="text" size="mini" icon={<IconBrush />} disabled={generating}>AI 润色 <IconDown /></Button></AntDropdown><Button className="regenerate-button body-regenerate" type="text" size="mini" icon={<IconRefresh />} loading={activeOperation === 'regenerate_body'} disabled={generating && activeOperation !== 'regenerate_body'} aria-label="换一批正文" onClick={() => handleRegenerate('body')}>换一批</Button></span>}>
          <div className={`rich-editor-stage ${activeOperation && streamPreview ? 'is-streaming' : ''}`}>
            <RichTextEditor value={result.bodyMarkdown || ''} onChange={(value) => updateResult({ bodyMarkdown: value })} readOnly={Boolean(activeOperation)} onPolish={polishContent} />
            {activeOperation && streamPreview && <div className="stream-candidate" aria-live="polite"><div className="stream-candidate-head"><span><IconRobot />AI 正在逐字改写</span><Button type="text" size="mini" icon={<IconStop />} onClick={cancelOperation}>停止</Button></div><RichTextEditor value={streamPreview} readOnly streaming /></div>}
            {activeOperation && !streamPreview && <div className="stream-waiting"><Spin size={18} /><span>{operationProgress === 'verifying' ? '正在检查字段和事实' : '正在准备改写内容'}</span><Button type="text" size="mini" icon={<IconStop />} onClick={cancelOperation}>停止</Button></div>}
          </div>
          {lastOperation && <div className="operation-result-bar"><span><IconCheckCircleFill />AI 修改已应用 · {lastOperation.changeSet.changedFields.length} 个字段有变化</span><span><Button type="text" size="mini" onClick={undoLastOperation}>撤销</Button><Button type="text" size="mini" onClick={showChangeSet}>查看对比</Button></span></div>}
        </Field>
        <Field className={`topic-field topic-platform-${platform}`} label={<span className="topic-field-title">{topicEditor.label}<small><IconRobot />AI 推荐，可编辑</small></span>} extra={<span className="topic-count">{topics.length}/{topicEditor.limit}</span>}><TopicEditor topics={topics} config={topicEditor} onChange={handleTopicsChange} /></Field>
      </div>
    </div>
    <section className="result-refine" aria-label="继续优化"><div className="refine-heading"><span className="refine-mark"><IconRobot /></span><span><strong>继续让 AI 优化</strong><small>修改前会自动保留当前版本</small></span></div><div>{quickActions.map((item) => <Button key={item.label} size="small" icon={item.icon} disabled={generating} onClick={() => quickModify(item.instruction)}>{item.label}</Button>)}</div></section>
    <footer className="result-actions"><AntDropdown menu={moreMenu} trigger={['click']} placement="topLeft"><Button size="small" icon={<IconMore />}>更多</Button></AntDropdown><Tooltip content="复制全文" position="top"><Button className="copy-result-button" type="text" size="small" icon={<IconCopy />} aria-label="复制全文" onClick={copyText} /></Tooltip></footer>
  </article></div>;
}

function TopicEditor({ topics, config, onChange }) {
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);
  const commit = () => {
    const topic = normalizeTopic(input);
    if (!topic) { setAdding(false); setInput(''); return; }
    if (topics.includes(topic)) { Message.info('这个标签已经添加'); setAdding(false); setInput(''); return; }
    if (topics.length >= config.limit) { Message.warning(`最多添加 ${config.limit} 个${config.itemLabel}`); return; }
    onChange(normalizeTopics([...topics, topic], config.limit));
    setAdding(false);
    setInput('');
  };
  return <div className="topic-chip-editor" aria-label={config.label}><div className="topic-chip-list">{topics.map((topic) => <Tag key={topic} className="topic-chip" closable onClose={() => onChange(topics.filter((item) => item !== topic))}>{config.marker}{topic}</Tag>)}{adding ? <Input ref={inputRef} className="custom-topic-input" value={input} onChange={setInput} placeholder={config.placeholder} onPressEnter={commit} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Escape') { setAdding(false); setInput(''); } }} /> : <Button className="custom-topic-button" type="text" size="small" icon={<IconPlus />} onClick={() => setAdding(true)}>自定义标签</Button>}</div></div>;
}

function Field({ label, extra, children, className = '' }) { return <section className={`result-field ${className}`}><div className="result-field-label"><b>{label}</b>{extra && <small>{extra}</small>}</div>{children}</section>; }

function PlatformBrand({ value }) {
  const option = platformOptions.find((item) => item.value === value) || platformOptions.at(-1);
  if (option.network) return <SocialIcon as="span" className="platform-brand social-brand" network={option.network} bgColor={option.color} fgColor="#fff" label={option.label} style={{ width: 22, height: 22 }} />;
  const BrandIcon = option.icon;
  return <span className="platform-brand" style={{ background: option.color }}><BrandIcon /></span>;
}

function PlatformChoice({ value, checked = false }) {
  const label = platformOptions.find((item) => item.value === value)?.label || '通用文案';
  return <span className="platform-choice"><PlatformBrand value={value} /><span>{label}</span>{checked && <IconCheck className="platform-check" />}</span>;
}

function ExpressionModePanel({ modes, pendingId, currentId, onSelect, pendingFeel, currentFeel, onFeelSelect, result, applying, generating, onApply, onClose, mobile, platform }) {
  const recommended = modes.find((mode) => mode.id !== 'smart') || expressionModes[1];
  const platformLabel = platformOptions.find((item) => item.value === platform)?.label || '通用文案';
  const selected = expressionModeById(pendingId);
  return <section className={`expression-mode-panel ${mobile ? 'is-mobile' : ''}`} aria-label="表达方式">
    <header className="expression-mode-head"><div><strong>表达方式</strong><small>{platformLabel} · AI 推荐已排序</small></div>{mobile && <Button type="text" icon={<IconClose />} aria-label="关闭表达方式" onClick={onClose} />}</header>
    {platform === 'xiaohongshu' && <div className="platform-feel-control"><div className="platform-feel-heading"><strong>平台感</strong><small>不影响事实，只调整排版节奏</small></div><Radio.Group type="button" className="platform-feel-options" value={pendingFeel} onChange={onFeelSelect} aria-label="小红书平台感">{platformFeelOptions.map((option) => <Radio key={option.id} value={option.id}><span className="platform-feel-option"><span className="rhythm-preview" aria-hidden="true">{option.rhythm.map((width, index) => <i key={index} style={{ width: `${width}px` }} />)}</span><span><b>{option.label}</b><small>{option.description}</small></span></span></Radio>)}</Radio.Group></div>}
    <Radio.Group className="expression-mode-list" value={pendingId} onChange={onSelect} aria-label="选择表达方式">
      {modes.map((mode) => {
        const active = pendingId === mode.id;
        const description = mode.id === 'smart' ? `${recommended.label}：${recommended.structure}` : mode.structure;
        return <label className={`expression-mode-option ${active ? 'is-active' : ''}`} key={mode.id}>
          <Radio value={mode.id} />
          <span className="expression-mode-copy"><span><strong>{mode.label}</strong>{mode.id === 'smart' && <em>推荐</em>}{mode.id === currentId && result && <i>当前</i>}</span><small>{description}</small></span>
        </label>;
      })}
    </Radio.Group>
    {result && <footer className="expression-mode-footer"><Button type="primary" long loading={applying} disabled={generating || (pendingId === currentId && pendingFeel === currentFeel)} onClick={() => onApply(pendingId, pendingFeel)}>应用表达设置</Button></footer>}
  </section>;
}

function ExpressionModePicker({ tone, platform, prompt, taskBrief, result, generating, onApply, formattingOverride }) {
  const mobile = useMobileViewport();
  const currentId = resolveExpressionModeId(tone);
  const [visible, setVisible] = useState(false);
  const [pendingId, setPendingId] = useState(currentId);
  const currentFeel = formattingOverride?.platformFeel || 'auto';
  const [pendingFeel, setPendingFeel] = useState(currentFeel);
  const [applying, setApplying] = useState(false);
  const modes = useMemo(() => {
    const recommended = recommendExpressionModes({ platform, prompt, taskBrief, result });
    if (!recommended.some((mode) => mode.id === currentId)) recommended.splice(-1, 1, expressionModeById(currentId));
    return recommended;
  }, [platform, prompt, taskBrief?.contentType, taskBrief?.instruction, result?.resultId, currentId]);
  const recommended = modes.find((mode) => mode.id !== 'smart') || expressionModes[1];
  const current = expressionModeById(currentId);
  const feelLabel = platformFeelOptions.find((item) => item.id === currentFeel)?.label || '自动';
  const triggerLabel = `${currentId === 'smart' ? `AI 推荐 · ${recommended.label}` : current.label}${platform === 'xiaohongshu' && currentFeel !== 'auto' ? ` · ${feelLabel}` : ''}`;
  const open = () => { setPendingId(currentId); setPendingFeel(currentFeel); setVisible(true); };
  const close = () => { if (!applying) setVisible(false); };
  const select = async (modeId) => {
    setPendingId(modeId);
    if (result) return;
    setApplying(true);
    try {
      const applied = await onApply(modeId, pendingFeel);
      if (applied !== false) setVisible(false);
    } finally { setApplying(false); }
  };
  const selectFeel = async (feelId) => {
    setPendingFeel(feelId);
    if (result) return;
    setApplying(true);
    try { await onApply(pendingId, feelId); } finally { setApplying(false); }
  };
  const apply = async (modeId, feelId) => {
    setApplying(true);
    try {
      const applied = await onApply(modeId, feelId);
      if (applied !== false) setVisible(false);
    } finally { setApplying(false); }
  };
  const panel = <ExpressionModePanel modes={modes} pendingId={pendingId} currentId={currentId} onSelect={select} pendingFeel={pendingFeel} currentFeel={currentFeel} onFeelSelect={selectFeel} result={result} applying={applying} generating={generating} onApply={apply} onClose={close} mobile={mobile} platform={platform} />;
  const trigger = <AntButton className={`sender-tool-button expression-mode-trigger ${visible ? 'is-open' : ''}`} type="text" size="small" icon={<IconBulb />} aria-label={`表达方式：${triggerLabel}`} aria-expanded={visible} onClick={mobile ? open : undefined}><span>{triggerLabel}</span><IconDown /></AntButton>;
  return <>
    {mobile ? trigger : <Trigger trigger="click" position="tl" popup={() => panel} popupVisible={visible} onVisibleChange={(next) => { if (next) open(); else close(); }} showArrow={false} autoFitPosition boundaryDistance={{ left: 12, bottom: 12 }}>{trigger}</Trigger>}
    {mobile && <Drawer wrapClassName="expression-mode-drawer" placement="bottom" height="min(78vh, 560px)" title={null} footer={null} closable={false} visible={visible} onCancel={close}>{panel}</Drawer>}
  </>;
}

function Composer({ prompt, setPrompt, platform, setPlatform, tone, formattingOverride, materials, removeMaterial, generating, submit, openMaterials, result, taskBrief, applyExpressionMode }) {
  const currentPlatform = platformOptions.find((item) => item.value === platform) || platformOptions[0];
  const platformMenu = {
    items: platformOptions.map((item) => ({ key: item.value, label: <PlatformChoice value={item.value} checked={item.value === platform} /> })),
    onClick: ({ key }) => setPlatform(key),
  };
  const header = materials.length > 0 ? <div className="sender-materials"><div className="material-chips">{materials.map((item) => <Tag key={item.id} closable onClose={() => removeMaterial(item.id)} icon={<IconFile />}>{item.displayName} · {item.characterCount} 字</Tag>)}</div></div> : false;
  return <ConfigProvider theme={{ token: { colorPrimary: '#175cd3', borderRadius: 8, fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif' } }}><div className="composer-wrap"><Sender className="content-sender" value={prompt} onChange={setPrompt} onSubmit={(message) => submit(message)} loading={generating} submitType="enter" autoSize={{ minRows: 2, maxRows: 7 }} placeholder={result ? '继续修改：换个开头、减少营销感，或改成其他平台...' : '描述你想写的内容，也可以添加产品介绍、活动信息或已有文案...'} header={header} suffix={false} footer={(_node, { components }) => { const ActionButton = generating ? components.LoadingButton : components.SendButton; return <div className="sender-footer"><div className="sender-controls"><AntButton className="sender-tool-button attach-button" type="text" size="small" icon={<IconAttachment />} aria-label="添加资料" onClick={openMaterials}>添加资料{materials.length ? ` (${materials.length})` : ''}</AntButton><AntDropdown menu={platformMenu} trigger={['click']} placement="topLeft" classNames={{ root: 'platform-dropdown' }}><AntButton className="sender-tool-button platform-trigger" type="text" size="small"><PlatformBrand value={platform} /><span>{currentPlatform.label}</span><IconDown /></AntButton></AntDropdown><ExpressionModePicker tone={tone} platform={platform} prompt={prompt} taskBrief={taskBrief} result={result} generating={generating} onApply={applyExpressionMode} formattingOverride={formattingOverride} /></div><ActionButton aria-label={generating ? '正在生成' : result ? '发送修改要求' : '生成文案'} /></div>; }} /></div></ConfigProvider>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
