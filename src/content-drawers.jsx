import React, { useRef, useState } from 'react';
import { Alert, Button, Drawer, Input, Message } from '@arco-design/web-react';
import { IconCheck, IconCheckCircleFill, IconEdit, IconExclamationCircleFill, IconInfoCircleFill, IconLink, IconUpload } from '@arco-design/web-react/icon';

const TextArea = Input.TextArea;

export function MaterialsDrawer({ visible, onClose, onOpenWorkspace, materials, onAdded, request }) {
  const [mode, setMode] = useState('file'); const [text, setText] = useState(''); const [url, setUrl] = useState(''); const [loading, setLoading] = useState(false); const inputRef = useRef(null);
  const addFiles = async (files) => { if (!files?.length) return; if (materials.length + files.length > 10) return Message.warning('单次最多使用 10 份资料'); setLoading(true); try { const form = new FormData(); [...files].forEach((file) => form.append('files', file)); const data = await request('/api/materials/upload', { method: 'POST', body: form }); onAdded(data.materials); Message.success('资料已读取'); } catch (error) { Message.error(error.message); } finally { setLoading(false); if (inputRef.current) inputRef.current.value = ''; } };
  const addStructured = async () => { setLoading(true); try { const data = mode === 'text' ? await request('/api/materials/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }) : await request('/api/materials/url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }); onAdded([data.material]); setText(''); setUrl(''); Message.success('资料已读取'); } catch (error) { Message.error(error.message); } finally { setLoading(false); } };
  return <Drawer title="添加资料" width={480} visible={visible} onCancel={onClose} footer={null}>
    <Alert type="info" content="截图、多份文档或需要逐条确认事实时，可进入完整资料整理。" action={<Button size="mini" onClick={onOpenWorkspace}>打开资料整理</Button>} style={{ marginBottom: 14 }} />
    <div className="material-modes"><button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}><IconUpload />上传文件</button><button className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}><IconEdit />粘贴文字</button><button className={mode === 'url' ? 'active' : ''} onClick={() => setMode('url')}><IconLink />网页链接</button></div>
    {mode === 'file' && <div className="upload-zone" onClick={() => inputRef.current?.click()}><input ref={inputRef} type="file" multiple accept=".txt,.md,.markdown,.pdf,.docx" onChange={(event) => addFiles(event.target.files)} /><IconUpload /><strong>{loading ? '正在读取资料' : '选择文件'}</strong><span>支持 TXT、Markdown、PDF、DOCX；单个文件不超过 20 MB</span></div>}
    {mode === 'text' && <div className="material-form"><TextArea value={text} onChange={setText} autoSize={{ minRows: 12 }} placeholder="粘贴需要用于写作的正文。文件名和来源说明不会进入对外文案。" /><Button type="primary" long loading={loading} disabled={!text.trim()} onClick={addStructured}>使用这段文字</Button></div>}
    {mode === 'url' && <div className="material-form"><Input value={url} onChange={setUrl} placeholder="https://example.com/article" /><Alert type="info" content="系统只读取你主动提供的网页，不会自动搜索或补充外部事实。" /><Button type="primary" long loading={loading} disabled={!url.trim()} onClick={addStructured}>读取网页</Button></div>}
    <div className="drawer-material-list"><h3>本次使用的资料 <small>{materials.length}/10</small></h3>{materials.length ? materials.map((item) => <div key={item.id}><IconCheck /><span><strong>{item.displayName}</strong><small>{item.kind === 'url' ? '网页' : item.kind === 'text' ? '粘贴文字' : '文件'} · {item.characterCount} 字</small></span></div>) : <p>尚未添加资料。清晰的单句需求也可以直接生成。</p>}</div>
  </Drawer>;
}

function humanizeQualityIssue(issue = '') {
  if (/缺少必需字段：topics|topics 至少需要/.test(issue)) return '话题标签不足 3 个，系统会自动补齐，也可以直接调整';
  if (/缺少必需字段：titleCandidates|titleCandidates 至少需要/.test(issue)) return '标题方案不足，系统会自动补充不同角度的标题';
  if (/缺少必需字段：bodyMarkdown/.test(issue)) return '正文内容还没有生成完整';
  return issue.replaceAll('topics', '话题标签').replaceAll('titleCandidates', '标题方案').replaceAll('bodyMarkdown', '正文');
}

export function QualityDrawer({ visible, onClose, result, onFix }) {
  const report = result?.qualityReport; const items = report ? [['事实检查', report.factCheck], ['来源隔离', report.sourceLeakCheck], ['平台结构', report.platformCheck], ['表达自然', report.aiStyleCheck], ['高风险表述', report.riskCheck]] : [];
  const blocked = report?.status === 'blocked';
  const visibleWarnings = [...new Set((report?.warnings || []).map(humanizeQualityIssue).filter(Boolean))];
  return <Drawer title="文案检查" width={440} visible={visible} onCancel={onClose} footer={null}>{!report ? <p>生成文案后显示检查结果。</p> : <><div className="quality-summary"><span className={blocked ? 'fail' : visibleWarnings.length ? 'warn' : 'pass'}>{blocked || visibleWarnings.length ? <IconExclamationCircleFill /> : <IconCheckCircleFill />}</span><div><strong>{blocked ? '有内容需要确认' : visibleWarnings.length ? '还有可以优化的地方' : '检查通过'}</strong><small>正文 {report.bodyLength} 字 · 已按当前平台要求检查</small></div></div><div className="quality-grid">{items.map(([label, state]) => <div key={label}><span className={state}><IconCheck /></span><strong>{label}</strong><small>{state === 'pass' ? '通过' : state === 'warning' ? '建议确认' : '需要确认'}</small></div>)}</div>{visibleWarnings.length > 0 && <div className="warning-list"><h3>{blocked ? '请确认' : '优化建议'}</h3>{visibleWarnings.map((warning) => <div key={warning}><p><IconInfoCircleFill />{warning}</p><Button size="mini" onClick={() => onFix(warning)}>让 AI 调整</Button></div>)}</div>}</>}</Drawer>;
}

function formatTime(value) {
  if (!value) return '刚刚';
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

export function VersionsDrawer({ visible, onClose, content, current, onUse }) {
  const versions = content?.versions || (current ? [current] : []);
  return <Drawer title="版本记录" width={440} visible={visible} onCancel={onClose} footer={null}><div className="version-list">{versions.slice().reverse().map((version, index) => <div key={version.id || index}><span className="version-dot" /><div><strong>{version.titleCandidates?.[version.selectedTitleIndex || 0] || content?.name || '未命名文案'}</strong><small>{formatTime(version.createdAt)} · {version.reason || '保存'}</small><p>{version.bodyMarkdown?.slice(0, 100)}</p></div><Button size="small" onClick={() => onUse(version)}>使用</Button></div>)}</div></Drawer>;
}
