import React, { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Alert, Button, Checkbox, Empty, Input, Message, Modal, Progress, Radio, Select, Spin, Tag, Tooltip } from '@arco-design/web-react';
import {
  IconCalendar, IconCheck, IconCheckCircleFill, IconClose, IconCopy, IconExperiment, IconFile,
  IconDelete, IconFolder, IconImage, IconInfoCircle, IconLink, IconPlus, IconRefresh, IconRight,
  IconSend, IconUpload,
} from '@arco-design/web-react/icon';

async function request(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let payload = {};
    try { payload = await response.json(); } catch { /* noop */ }
    const error = new Error(payload.error || '操作没有完成');
    error.code = payload.code || 'REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

function PageHeading({ eyebrow, title, subtitle, actions }) {
  return <div className="roadmap-page-heading"><div><span>{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div><div className="roadmap-page-actions">{actions}</div></div>;
}

function sourceIcon(type) {
  if (type === 'image') return <IconImage />;
  if (type === 'url') return <IconLink />;
  return <IconFile />;
}

function EvidenceList({ title, tone, items, selectedFactId, onSelect, emptyText }) {
  return <section className="evidence-group"><div className="evidence-group-title"><i className={tone} /><span>{title}</span><b>{items.length}</b></div>{items.length ? items.map((fact) => <button key={fact.factId} className={`evidence-row ${selectedFactId === fact.factId ? 'selected' : ''}`} onClick={() => onSelect(fact)}><span className={`evidence-status ${fact.userStatus}`}><IconCheck /></span><span><strong>{fact.statement}</strong><small>{fact.evidenceClass === 'image_observation' ? '图片观察 · 确认后才会用于文案' : fact.evidenceClass === 'user_claim' ? '用户说明 · 可用于文案' : '资料事实 · 可追溯'}</small></span>{fact.usableForClaims || fact.evidenceClass !== 'image_observation' ? <Tag size="small" color="green">可用于文案</Tag> : <Tag size="small" color="arcoblue">待确认</Tag>}<IconRight /></button>) : <div className="evidence-empty">{emptyText}</div>}</section>;
}

export function MaterialsWorkspace({ materialSetId, onMaterialSetChange, onUseForCreation }) {
  const [materialSet, setMaterialSet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [selectedFact, setSelectedFact] = useState(null);
  const [textOpen, setTextOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [pendingJobs, setPendingJobs] = useState([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const fileRef = useRef(null);

  const load = async (id = materialSetId) => {
    if (!id) {
      const data = await request('/api/material-sets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction: '' }) });
      onMaterialSetChange(data.materialSet.materialSetId);
      setMaterialSet(data.materialSet);
      return;
    }
    const data = await request(`/api/material-sets/${id}`);
    setMaterialSet(data.materialSet);
  };

  useEffect(() => { setLoading(true); load().catch((error) => Message.error(error.message)).finally(() => setLoading(false)); }, [materialSetId]);

  useEffect(() => {
    if (!pendingJobs.length || !materialSet?.materialSetId) return undefined;
    let stopped = false;
    const poll = async () => {
      try {
        const jobs = await Promise.all(pendingJobs.map((id) => request(`/api/material-analysis-jobs/${id}`)));
        if (stopped) return;
        const finished = jobs.filter(({ job }) => ['completed', 'partial', 'cancelled'].includes(job.status));
        const active = jobs.filter(({ job }) => !['completed', 'partial', 'cancelled'].includes(job.status)).map(({ job }) => job.jobId);
        const latest = await request(`/api/material-sets/${materialSet.materialSetId}`);
        if (stopped) return;
        setMaterialSet(latest.materialSet);
        setPendingJobs(active);
        if (finished.length) {
          const hasFailure = finished.some(({ job }) => job.status === 'partial');
          (hasFailure ? Message.warning : Message.success)(hasFailure ? '部分资料未能整理，可单独重试' : '资料已整理完成');
        }
      } catch (error) { if (!stopped) Message.error(error.message); }
    };
    void poll();
    const timer = window.setInterval(poll, 700);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [pendingJobs.join('|'), materialSet?.materialSetId]);

  const acceptQueued = (data, successText) => {
    setMaterialSet(data.materialSet);
    if (data.job?.jobId) setPendingJobs((current) => [...new Set([...current, data.job.jobId])]);
    if (data.duplicates?.length) Message.info(`已跳过 ${data.duplicates.length} 项重复资料`);
    if (data.job) Message.success(successText);
  };

  const addFiles = async (files) => {
    if (!files?.length || !materialSet?.materialSetId) return;
    setAdding(true);
    try {
      const form = new FormData();
      [...files].forEach((file) => form.append('files', file));
      const data = await request(`/api/material-sets/${materialSet.materialSetId}/items`, { method: 'POST', body: form });
      acceptQueued(data, `已加入 ${data.queued.length} 项资料，正在后台整理`);
    } catch (error) { Message.error(error.message); }
    finally { setAdding(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const addText = async () => {
    if (!text.trim()) return;
    setAdding(true);
    try {
      const data = await request(`/api/material-sets/${materialSet.materialSetId}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ type: 'user_text', name: '补充说明', text }] }) });
      acceptQueued(data, '补充说明已加入整理'); setText(''); setTextOpen(false);
    } catch (error) { Message.error(error.message); }
    finally { setAdding(false); }
  };

  const addUrl = async () => {
    if (!url.trim()) return;
    setAdding(true);
    try {
      const data = await request(`/api/material-sets/${materialSet.materialSetId}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ type: 'url', url }] }) });
      acceptQueued(data, '网页已加入整理'); setUrl(''); setUrlOpen(false);
    } catch (error) { Message.error(error.message); }
    finally { setAdding(false); }
  };

  const updateFact = async (fact, patch) => {
    try {
      const data = await request(`/api/material-sets/${materialSet.materialSetId}/facts/${fact.factId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': String(materialSet.revision) }, body: JSON.stringify(patch) });
      setMaterialSet(data.materialSet);
      const nextFact = [...data.materialSet.analysis.imageObservations, ...data.materialSet.analysis.verifiedFacts, ...data.materialSet.analysis.userClaims].find((item) => item.factId === fact.factId);
      setSelectedFact(nextFact || null);
      Message.success(patch.userStatus === 'ignored' ? '已忽略这条信息' : '事实已确认');
    } catch (error) { Message.error(error.message); }
  };

  const retryItem = async (sourceId) => {
    try {
      const data = await request(`/api/material-sets/${materialSet.materialSetId}/items/${sourceId}/retry`, { method: 'POST' });
      acceptQueued(data, '已重新开始整理');
    } catch (error) { Message.error(error.message); }
  };

  const removeItem = async (sourceId) => {
    try {
      const data = await request(`/api/material-sets/${materialSet.materialSetId}/items/${sourceId}`, { method: 'DELETE' });
      setMaterialSet(data.materialSet); setSelectedFact(null);
      if (selectedSourceId === sourceId) setSelectedSourceId('');
      Message.success('资料已删除');
    } catch (error) { Message.error(error.message); }
  };

  const analysis = materialSet?.analysis || { verifiedFacts: [], userClaims: [], imageObservations: [], unknowns: [], sourceSummaries: [] };
  const selectedSource = selectedFact ? materialSet.items.find((item) => item.sourceId === selectedFact.sourceId) : materialSet?.items.find((item) => item.sourceId === selectedSourceId) || materialSet?.items.find((item) => item.type === 'image') || materialSet?.items[0];
  if (loading) return <div className="roadmap-loading"><Spin /><span>正在打开创作资料</span></div>;

  return <section className="roadmap-workspace materials-workspace">
    <PageHeading eyebrow="素材理解" title="整理创作资料" subtitle={`${materialSet?.items.length || 0} 个来源 · ${analysis.verifiedFacts.length + analysis.userClaims.length} 条可用信息`} actions={<><Tooltip content="读取你明确提供的网页"><Button icon={<IconLink />} onClick={() => setUrlOpen(true)} aria-label="添加网页链接" /></Tooltip><Button icon={<IconPlus />} onClick={() => setTextOpen(true)}>粘贴文字</Button><Button type="primary" icon={<IconRight />} disabled={!analysis.verifiedFacts.length && !analysis.userClaims.length} onClick={() => onUseForCreation(materialSet)}>用这些资料创作</Button></>} />
    <div className="material-workbench">
      <main className="material-column">
        <div className="material-dropzone" role="button" tabIndex={0} onClick={() => fileRef.current?.click()} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileRef.current?.click(); }} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }} onDragOver={(event) => event.preventDefault()}>
          <span><IconUpload /></span><div><strong>{adding ? '正在上传资料…' : pendingJobs.length ? '资料正在后台整理，可继续添加' : '添加截图、文档或网页导出文件'}</strong><small>支持 PNG、JPG、WebP、TXT、Markdown、PDF 和 DOCX，单项不超过 20 MB</small></div><Button loading={adding} icon={<IconFolder />}>选择文件</Button>
        </div>
        <input ref={fileRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,.txt,.md,.markdown,.pdf,.docx" onChange={(event) => addFiles(event.target.files)} />
        <div className="material-block-heading"><div><h2>资料来源</h2><span>每条信息都能回到原位置</span></div><Tag>{analysis.status === 'processing' ? '整理中' : analysis.status === 'partial' ? '部分完成' : '分析完成'}</Tag></div>
        <div className="material-source-list">{materialSet?.items.length ? materialSet.items.map((item) => <div key={item.sourceId} className={`material-source-row ${selectedSource?.sourceId === item.sourceId ? 'active' : ''}`}><button className="material-source-main" onClick={() => { setSelectedFact(null); setSelectedSourceId(item.sourceId); }}><span className={`source-glyph ${item.type}`}>{sourceIcon(item.type)}</span><span><strong>{item.name}</strong><small>{['queued', 'processing'].includes(item.status) ? '正在提取和整理信息' : item.status === 'partial' ? '需要视觉模型或人工确认' : item.status === 'failed' ? item.error : `${item.evidence?.length || 0} 条信息`}</small></span><Tag size="small" color={item.status === 'ready' ? 'green' : item.status === 'failed' ? 'red' : 'orange'}>{item.status === 'ready' ? '已整理' : item.status === 'failed' ? '失败' : ['queued', 'processing'].includes(item.status) ? '整理中' : '部分完成'}</Tag></button><div className="material-source-actions">{item.status === 'failed' && <Tooltip content="重新整理"><Button size="mini" type="text" icon={<IconRefresh />} aria-label="重新整理" onClick={() => retryItem(item.sourceId)} /></Tooltip>}<Tooltip content="删除资料"><Button size="mini" type="text" status="danger" icon={<IconDelete />} aria-label="删除资料" onClick={() => removeItem(item.sourceId)} /></Tooltip></div></div>) : <Empty description="还没有资料，可以先上传截图或粘贴产品介绍" />}</div>
        <div className="material-block-heading"><div><h2>整理出的信息</h2><span>只有确认后的图片观察才会进入文案</span></div><span className="trace-status"><IconCheckCircleFill /> 来源可追溯</span></div>
        <div className="evidence-columns">
          <EvidenceList title="可用事实" tone="confirmed" items={[...analysis.userClaims, ...analysis.verifiedFacts]} selectedFactId={selectedFact?.factId} onSelect={setSelectedFact} emptyText="添加一句产品介绍即可开始" />
          <EvidenceList title="图片观察" tone="observed" items={analysis.imageObservations} selectedFactId={selectedFact?.factId} onSelect={setSelectedFact} emptyText={materialSet?.items.some((item) => item.type === 'image') ? '图片没有可用观察，检查视觉模型配置' : '上传产品截图后在这里核对'} />
        </div>
      </main>
      <aside className="evidence-preview">
        {selectedSource ? <>
          <div className="preview-source-head"><span className={`source-glyph ${selectedSource.type}`}>{sourceIcon(selectedSource.type)}</span><div><strong>{selectedSource.name}</strong><small>{selectedSource.type === 'image' ? `${selectedSource.width || '?'} × ${selectedSource.height || '?'} · ${selectedSource.analysisStatus === 'analysis_unavailable' ? '视觉分析未配置' : '图片来源'}` : '用户提供的资料'}</small></div></div>
          {selectedSource.type === 'image' ? <div className="actual-image-preview"><img src={`/api/material-sets/${materialSet.materialSetId}/items/${selectedSource.sourceId}/asset`} alt={selectedSource.name} />{selectedFact?.locator?.x !== undefined && selectedSource.width ? <i style={{ left: `${selectedFact.locator.x / selectedSource.width * 100}%`, top: `${selectedFact.locator.y / selectedSource.height * 100}%`, width: `${selectedFact.locator.width / selectedSource.width * 100}%`, height: `${selectedFact.locator.height / selectedSource.height * 100}%` }} /> : null}</div> : <div className="text-source-preview">{selectedSource.excerpt || '这项资料没有可显示的文字摘要。'}</div>}
          {selectedFact ? <div className="selected-evidence-detail"><span>当前信息</span><h3>{selectedFact.statement}</h3><p>{selectedFact.evidenceClass === 'image_observation' ? '这是从界面中读到的观察。确认后，它才会成为文案可使用的产品事实。' : '这条信息来自用户明确提供的资料，可以用于内容生成。'}</p>{selectedFact.confidence !== undefined && <><div className="confidence-line"><span>提取可信度</span><b>{Math.round(selectedFact.confidence * 100)}%</b></div><Progress percent={Math.round(selectedFact.confidence * 100)} showText={false} size="small" /></>}<div className="evidence-actions"><Button icon={<IconClose />} onClick={() => updateFact(selectedFact, { userStatus: 'ignored' })}>忽略</Button>{selectedFact.evidenceClass === 'image_observation' && <Button type="primary" icon={<IconCheck />} onClick={() => updateFact(selectedFact, { userStatus: 'confirmed' })}>确认事实</Button>}</div></div> : <div className="preview-guidance"><IconInfoCircle /><span>选择一条信息，可以查看它来自哪里以及是否能够用于文案。</span></div>}
          {!!analysis.unknowns.length && <div className="unknown-facts"><IconInfoCircle /><div><strong>仍然未知</strong>{analysis.unknowns.map((item) => <span key={String(item)}>{typeof item === 'string' ? item : item.statement}</span>)}</div></div>}
        </> : <Empty description="选择资料查看来源" />}
      </aside>
    </div>
    <Modal title="粘贴产品说明或创作要求" visible={textOpen} onCancel={() => setTextOpen(false)} onOk={addText} okButtonProps={{ loading: adding, disabled: !text.trim() }}><Input.TextArea value={text} onChange={setText} autoSize={{ minRows: 6, maxRows: 12 }} placeholder="例如：CodeLoop 可以读取授权代码仓库，把目标拆成计划，修改代码并运行项目测试。" /></Modal>
    <Modal title="添加你允许读取的网页" visible={urlOpen} onCancel={() => setUrlOpen(false)} onOk={addUrl} okText="读取网页" okButtonProps={{ loading: adding, disabled: !url.trim() }}><Alert type="info" content="Narraform 只读取你在这里明确提交的网页，不会自行搜索或访问其他链接。" style={{ marginBottom: 12 }} /><Input value={url} onChange={setUrl} placeholder="https://example.com/product" /></Modal>
  </section>;
}

const platformMeta = {
  xiaohongshu: { label: '小红书', short: '小', tone: 'red' },
  zhihu: { label: '知乎', short: '知', tone: 'blue' },
  wechat: { label: '微信公众号', short: '微', tone: 'green' },
};

function packageMarkdown(pkg) {
  const fields = pkg.fields || {};
  const title = fields.title || fields.questionTitle || '';
  const summary = fields.summary || fields.digest || '';
  const topics = (fields.topics || []).map((topic) => `#${topic}`).join(' ');
  return [`# ${title}`, summary, fields.body || '', topics].filter(Boolean).join('\n\n');
}

async function exportPublishPackages(packages) {
  const zip = new JSZip();
  for (const pkg of packages) {
    const folder = zip.folder(pkg.platform);
    folder.file('content.md', packageMarkdown(pkg));
    folder.file('fields.json', `${JSON.stringify(pkg.fields, null, 2)}\n`);
    for (let index = 0; index < pkg.assets.length; index += 1) {
      const asset = pkg.assets[index];
      if (!asset.sourceUrl) continue;
      const response = await fetch(asset.sourceUrl);
      if (!response.ok) throw new Error(`无法读取 ${pkg.platform} 的第 ${index + 1} 张图片`);
      const mimeType = response.headers.get('Content-Type') || 'image/png';
      const extension = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
      folder.file(`images/${String(index + 1).padStart(2, '0')}-${asset.role || 'content'}.${extension}`, await response.arrayBuffer());
    }
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'narraform-publish-package.zip'; anchor.click();
  URL.revokeObjectURL(url);
}

export function PublishWorkspace({ materialSetId }) {
  const [contents, setContents] = useState([]);
  const [contentId, setContentId] = useState('');
  const [platforms, setPlatforms] = useState(['xiaohongshu']);
  const [packages, setPackages] = useState([]);
  const [preflights, setPreflights] = useState({});
  const [job, setJob] = useState(null);
  const [activePlatform, setActivePlatform] = useState('xiaohongshu');
  const [loading, setLoading] = useState(false);
  const [materialSet, setMaterialSet] = useState(null);
  const [loginStarting, setLoginStarting] = useState(false);

  useEffect(() => {
    Promise.all([request('/api/contents'), materialSetId ? request(`/api/material-sets/${materialSetId}`).catch(() => null) : null]).then(([contentData, materialData]) => {
      setContents(contentData.contents || []); setContentId(contentData.contents?.[0]?.id || ''); setMaterialSet(materialData?.materialSet || null);
    }).catch((error) => Message.error(error.message));
  }, [materialSetId]);

  useEffect(() => {
    if (!job || !['queued', 'created', 'running'].includes(job.status)) return undefined;
    let stopped = false;
    const poll = async () => {
      try {
        const data = await request(`/api/delivery-jobs/${job.jobId}`);
        if (stopped) return;
        setJob(data.job);
        if (data.job.status === 'delivered') Message.success('草稿已送达并完成验证');
        else if (data.job.status === 'waiting_session') Message.info('发布包已就绪，等待配置平台连接器或登录会话');
        else if (['partial', 'failed', 'uncertain'].includes(data.job.status)) Message.warning('部分平台未能完成，请检查后重试');
      } catch (error) { if (!stopped) Message.error(error.message); }
    };
    void poll();
    const timer = window.setInterval(poll, 800);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [job?.jobId, job?.status]);

  const selectedContent = contents.find((item) => item.id === contentId);
  const createPackages = async () => {
    if (!contentId) return Message.info('请先完成并保存一篇内容');
    setLoading(true); setJob(null);
    try {
      const assets = (materialSet?.items || []).filter((item) => item.type === 'image').map((item, index) => ({ assetId: item.sourceId, type: 'image', role: index === 0 ? 'cover' : 'content', order: index + 1, sourceUrl: `/api/material-sets/${materialSet.materialSetId}/items/${item.sourceId}/asset` }));
      const data = await request('/api/publish-packages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentId, contentRevision: selectedContent.revision, platforms, target: 'draft', assets }) });
      const checks = {};
      for (const pkg of data.packages) checks[pkg.packageId] = (await request(`/api/publish-packages/${pkg.packageId}/preflight`, { method: 'POST' })).preflight;
      setPackages(data.packages); setPreflights(checks);
      setActivePlatform(data.packages[0]?.platform || platforms[0]);
      Message.success('平台发布包已生成');
    } catch (error) { Message.error(error.message); }
    finally { setLoading(false); }
  };

  const deliver = async () => {
    const ready = packages.filter((pkg) => preflights[pkg.packageId]?.status !== 'blocked');
    if (!ready.length) return Message.warning('先处理发布前检查中的阻断项');
    setLoading(true);
    try {
      const data = await request('/api/delivery-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packageIds: ready.map((item) => item.packageId) }) });
      setJob(data.job);
      Message.success('发布任务已进入后台队列');
    } catch (error) { Message.error(error.message); }
    finally { setLoading(false); }
  };

  const retryDelivery = async () => {
    if (!job) return;
    setLoading(true);
    try {
      const data = await request(`/api/delivery-jobs/${job.jobId}/retry`, { method: 'POST' });
      setJob(data.job);
      Message.info('已重新排队检查失败项和平台连接状态');
    } catch (error) { Message.error(error.message); }
    finally { setLoading(false); }
  };

  const copyActivePackage = async () => {
    if (!activePackage) return;
    try { await navigator.clipboard.writeText(packageMarkdown(activePackage)); Message.success('当前平台字段已复制'); }
    catch { Message.error('复制失败，请检查浏览器剪贴板权限'); }
  };

  const startLogin = async () => {
    setLoginStarting(true);
    try {
      const data = await request(`/api/platform-sessions/${activePlatform}/login`, { method: 'POST' });
      const loginUrl = data.session.browserUrl || data.session.loginUrl || data.session.qrCodeUrl;
      if (loginUrl) window.open(loginUrl, '_blank', 'noopener,noreferrer');
      Message.info(data.session.message || '请在打开的页面中完成登录，完成后重新检查连接');
    } catch (error) { Message.error(error.message); }
    finally { setLoginStarting(false); }
  };

  const activePackage = packages.find((item) => item.platform === activePlatform) || packages[0];
  const activePreflight = activePackage ? preflights[activePackage.packageId] : null;
  return <section className="roadmap-workspace publish-workspace">
    <PageHeading eyebrow="平台发布" title="保存到平台草稿" subtitle="内容版本固定后生成发布包，送达成功必须经过平台回执验证" actions={<><Tooltip content="复制当前平台的标题、正文和话题"><Button icon={<IconCopy />} aria-label="复制当前平台字段" onClick={copyActivePackage} disabled={!activePackage} /></Tooltip><Button onClick={() => exportPublishPackages(packages).then(() => Message.success('Markdown、字段和图片已打包')).catch((error) => Message.error(error.message))} disabled={!packages.length}>导出 ZIP</Button>{job?.status === 'waiting_session' && <Button loading={loginStarting} onClick={startLogin}>登录当前平台</Button>}<Button type="primary" icon={<IconSend />} loading={loading} onClick={packages.length ? deliver : createPackages}>{packages.length ? `保存到 ${packages.length} 个平台草稿` : '生成平台发布包'}</Button></>} />
    <div className="publish-config-bar"><label>内容</label><Select value={contentId} onChange={(value) => { setContentId(value); setPackages([]); setJob(null); }} placeholder="选择已保存内容" style={{ width: 280 }}>{contents.map((item) => <Select.Option key={item.id} value={item.id}>{item.name} · 版本 {item.revision || item.versionCount}</Select.Option>)}</Select><label>目标平台</label><Checkbox.Group value={platforms} onChange={(value) => { setPlatforms(value); setPackages([]); }}>{Object.entries(platformMeta).map(([value, meta]) => <Checkbox key={value} value={value}>{meta.label}</Checkbox>)}</Checkbox.Group><span><IconInfoCircle /> 默认只保存草稿，不会直接公开</span></div>
    {!selectedContent ? <div className="roadmap-empty-action"><Empty description="还没有可发布内容" /><Button type="primary">先去完成一篇内容</Button></div> : <div className="delivery-workbench">
      <aside className="delivery-platforms"><h3>平台版本</h3>{platforms.map((platform) => { const meta = platformMeta[platform]; const pkg = packages.find((item) => item.platform === platform); const preflight = pkg ? preflights[pkg.packageId] : null; const jobItem = job?.items.find((item) => item.platform === platform); return <button type="button" className={`delivery-platform ${pkg ? 'prepared' : ''} ${activePackage?.platform === platform ? 'active' : ''}`} key={platform} onClick={() => setActivePlatform(platform)}><span className={`platform-square ${meta.tone}`}>{meta.short}</span><span><strong>{meta.label}</strong><small>{jobItem ? jobItem.status === 'delivered' ? '已送达并验证' : jobItem.status === 'waiting_session' ? '等待平台连接' : ['queued', 'submitting', 'verifying'].includes(jobItem.status) ? '正在后台提交' : jobItem.status : preflight ? preflight.status === 'blocked' ? '需要处理检查项' : '发布包已就绪' : '等待生成发布包'}</small></span><i className={jobItem?.status === 'delivered' ? 'success' : preflight?.status === 'blocked' ? 'danger' : pkg ? 'ready' : ''} /></button>; })}{job && ['failed', 'partial', 'waiting_session'].includes(job.status) && <Button long icon={<IconRefresh />} loading={loading} onClick={retryDelivery}>{job.status === 'waiting_session' ? '重新检查平台连接' : '重试失败平台'}</Button>}<div className="draft-first-note"><IconInfoCircle /><span>每个平台单独提交。一个平台失败不会影响其他平台，重复点击使用同一幂等键。</span></div></aside>
      <main className="package-editor">{activePackage ? <><div className="package-title"><span className={`platform-square ${platformMeta[activePackage.platform].tone}`}>{platformMeta[activePackage.platform].short}</span><div><h2>{platformMeta[activePackage.platform].label}发布包</h2><span>绑定内容版本 {activePackage.contentRevision} · Spec {activePackage.platformSpecVersion}</span></div><Tag color="arcoblue">不可变版本</Tag></div><section className="package-field"><label>标题</label><Input value={activePackage.fields.title || activePackage.fields.questionTitle || '知乎回答'} readOnly /></section><section className="package-field"><label>正文</label><div className="package-body">{activePackage.fields.body}</div></section>{activePackage.fields.topics && <section className="package-field"><label>话题</label><div className="package-topics">{activePackage.fields.topics.map((topic) => <Tag key={topic}># {topic}</Tag>)}</div></section>}<section className="package-field"><label>素材</label><div className="package-assets">{activePackage.assets.length ? activePackage.assets.map((asset, index) => <img key={asset.assetId} src={asset.sourceUrl} alt={`发布素材 ${index + 1}`} />) : <span>当前没有图片素材</span>}</div></section></> : <div className="roadmap-empty-action"><Empty description="选择平台后生成发布包，系统会检查字段和素材" /><Button type="primary" onClick={createPackages} loading={loading}>生成平台发布包</Button></div>}</main>
      <aside className="preflight-column"><h3>发布前检查</h3>{activePreflight ? <><div className={`preflight-score ${activePreflight.status}`}><span>准备状态</span><strong>{activePreflight.status === 'pass' ? '可以保存草稿' : activePreflight.status === 'warning' ? '可以继续，有建议' : '需要处理'}</strong></div>{activePreflight.checks.map((item) => <div className={`preflight-check ${item.status}`} key={item.id}>{item.status === 'pass' ? <IconCheckCircleFill /> : <IconInfoCircle />}<span>{item.message}</span></div>)}<div className="connector-status"><span>平台连接器</span><strong>{activePreflight.capabilities.verifyDraft ? '可以提交并验证' : '尚未连接'} </strong><small>{activePreflight.capabilities.verifyDraft ? '送达后反查平台草稿' : '当前可导出内容包；配置连接器后继续'}</small></div>{job && <div className={`delivery-job-state ${job.status}`}><IconSend /><div><strong>{job.status === 'delivered' ? '草稿已验证送达' : job.status === 'waiting_session' ? '等待平台连接' : ['queued', 'running'].includes(job.status) ? '正在后台提交草稿' : '发布任务已完成'}</strong><span>{job.items.map((item) => `${platformMeta[item.platform].label}：${item.status}`).join(' · ')}</span></div></div>}</> : <div className="preflight-placeholder"><IconCheckCircleFill /><span>生成发布包后，这里会显示平台字段、素材和连接器检查。</span></div>}</aside>
    </div>}
  </section>;
}

function metricValue(snapshot, key) {
  const value = snapshot?.normalizedMetrics?.[key];
  return typeof value === 'object' ? value.value : value;
}

export function ReviewWorkspace() {
  const [contents, setContents] = useState([]);
  const [contentId, setContentId] = useState('');
  const [snapshots, setSnapshots] = useState([]);
  const [retrospective, setRetrospective] = useState(null);
  const [metricOpen, setMetricOpen] = useState(false);
  const [metrics, setMetrics] = useState({ impressions: '', reads: '', likes: '', saves: '', comments: '', shares: '' });
  const [loading, setLoading] = useState(false);
  const [approvedRule, setApprovedRule] = useState(null);
  const [ruleDraft, setRuleDraft] = useState('');

  useEffect(() => { request('/api/contents').then((data) => { setContents(data.contents || []); setContentId(data.contents?.[0]?.id || ''); }).catch((error) => Message.error(error.message)); }, []);
  useEffect(() => { if (!contentId) return; request(`/api/contents/${contentId}/performance`).then((data) => { setSnapshots(data.snapshots); setRetrospective(null); setApprovedRule(null); setRuleDraft(''); }).catch((error) => Message.error(error.message)); }, [contentId]);
  const selectedContent = contents.find((item) => item.id === contentId);
  const current = snapshots[0];

  const saveMetrics = async () => {
    const rawMetrics = Object.fromEntries(Object.entries(metrics).filter(([, value]) => value !== '').map(([key, value]) => [key, Number(value)]));
    if (!Object.keys(rawMetrics).length) return;
    setLoading(true);
    try {
      const data = await request('/api/performance-snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentId, contentRevision: selectedContent.revision, platform: selectedContent.platform, goal: 'save', contentType: selectedContent.latestVersion?.strategySnapshot?.contentType || 'product_marketing', ageHours: 48, source: 'manual', rawMetrics, dataQuality: 'complete' }) });
      setSnapshots((items) => [data.snapshot, ...items]); setMetricOpen(false); Message.success('表现数据已保存');
      const review = await request(`/api/contents/${contentId}/retrospective`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snapshotId: data.snapshot.snapshotId }) });
      setRetrospective(review);
    } catch (error) { Message.error(error.message); }
    finally { setLoading(false); }
  };

  const syncMetrics = async () => {
    if (!selectedContent) return;
    setLoading(true);
    try {
      const data = await request('/api/performance-snapshots/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentId, contentRevision: selectedContent.revision, platform: selectedContent.platform, goal: 'save', contentType: selectedContent.latestVersion?.strategySnapshot?.contentType || 'product_marketing', ageHours: 48 }) });
      setSnapshots((items) => [data.snapshot, ...items]);
      Message.success('平台表现已同步');
    } catch (error) { Message.warning(error.message); }
    finally { setLoading(false); }
  };

  const generateReview = async () => {
    setLoading(true);
    try { setRetrospective(await request(`/api/contents/${contentId}/retrospective`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snapshotId: current?.snapshotId }) })); }
    catch (error) { Message.error(error.message); }
    finally { setLoading(false); }
  };

  const approve = async () => {
    try { const data = await request(`/api/learning-rules/${retrospective.insight.insightId}/approve`, { method: 'POST' }); setApprovedRule(data.rule); setRuleDraft(data.rule.rule); setRetrospective((value) => ({ ...value, insight: { ...value.insight, status: 'approved' } })); Message.success('这条经验会在适用的新任务中显示'); }
    catch (error) { Message.error(error.message); }
  };

  const updateApprovedRule = async (patch) => {
    if (!approvedRule) return;
    try {
      const data = await request(`/api/learning-rules/${approvedRule.ruleId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      setApprovedRule(data.rule); setRuleDraft(data.rule.rule);
      Message.success(patch.status === 'inactive' ? '已停用这条经验' : '创作经验已更新');
    } catch (error) { Message.error(error.message); }
  };

  const saveRate = metricValue(current, 'saveRate');
  return <section className="roadmap-workspace review-workspace">
    <PageHeading eyebrow="反馈闭环" title="内容复盘" subtitle="表现只和同平台、同目标、同内容类型比较，建议由你决定是否复用" actions={<><Select value={contentId} onChange={setContentId} placeholder="选择内容" style={{ width: 250 }}>{contents.map((item) => <Select.Option key={item.id} value={item.id}>{item.name}</Select.Option>)}</Select><Button icon={<IconRefresh />} loading={loading} disabled={!contentId} onClick={syncMetrics}>同步平台数据</Button><Button type="primary" icon={<IconPlus />} disabled={!contentId} onClick={() => setMetricOpen(true)}>补充表现数据</Button></>} />
    {!selectedContent ? <div className="roadmap-empty-action"><Empty description="完成并保存内容后可以记录表现" /></div> : <div className="review-workbench">
      <main className="review-timeline"><div className="review-summary-strip"><div><span className="review-summary-icon"><IconSend /></span><span><small>内容版本</small><strong>{selectedContent.revision || selectedContent.versionCount}</strong></span></div><div><span className="review-summary-icon amber"><IconCalendar /></span><span><small>表现快照</small><strong>{snapshots.length}</strong></span></div><div><span className="review-summary-icon green"><IconExperiment /></span><span><small>复盘状态</small><strong>{retrospective?.insight ? '有建议' : current ? '待复盘' : '待数据'}</strong></span></div></div>
        <section className="content-journey"><div className="journey-heading"><h2>{selectedContent.name}</h2><Tag color="red">{platformMeta[selectedContent.platform]?.label || selectedContent.platform}</Tag><span>版本 {selectedContent.revision || selectedContent.versionCount}</span></div><div className="journey-steps"><div className="done"><i><IconCheck /></i><span><strong>内容已保存</strong><small>事实与平台检查完成</small></span></div><b /><div className={current ? 'done' : ''}><i>{current ? <IconCheck /> : '2'}</i><span><strong>表现已收集</strong><small>{current ? `${current.ageHours} 小时 · ${current.source === 'manual' ? '手工录入' : '平台同步'}` : '等待补充平台数据'}</small></span></div><b /><div className={retrospective ? 'active' : ''}><i><IconExperiment /></i><span><strong>形成复盘</strong><small>{retrospective?.insight ? '有一条建议待决定' : retrospective?.baseline?.status === 'insufficient' ? '同类样本不足' : '尚未生成'}</small></span></div></div></section>
        <section className="snapshot-history"><div className="material-block-heading"><div><h2>表现记录</h2><span>每次采集生成独立快照，不覆盖历史</span></div>{current && <Button icon={<IconRefresh />} loading={loading} onClick={generateReview}>生成复盘</Button>}</div>{snapshots.length ? snapshots.map((snapshot) => <div className="snapshot-row" key={snapshot.snapshotId}><span className="platform-square red">小</span><span><strong>{new Date(snapshot.capturedAt).toLocaleString('zh-CN')}</strong><small>{snapshot.source === 'manual' ? '手工录入' : '平台同步'} · 数据{snapshot.dataQuality === 'complete' ? '完整' : '部分'}</small></span><span><small>阅读</small><b>{snapshot.normalizedMetrics.reads?.toLocaleString?.() ?? '—'}</b></span><span><small>收藏</small><b>{snapshot.normalizedMetrics.saves?.toLocaleString?.() ?? '—'}</b></span><span><small>收藏率</small><b>{metricValue(snapshot, 'saveRate') !== undefined ? `${(metricValue(snapshot, 'saveRate') * 100).toFixed(2)}%` : '—'}</b></span></div>) : <Empty description="还没有表现数据，发布后可以手工录入或从平台同步" />}</section>
      </main>
      <aside className="review-insight-panel">{current ? <><div className="current-performance"><span>最新阅读</span><strong>{current.normalizedMetrics.reads?.toLocaleString?.() ?? '—'}</strong><em>{current.ageHours} 小时表现</em></div><div className="performance-grid">{[['点赞','likes'],['收藏','saves'],['评论','comments'],['分享','shares']].map(([label,key]) => <div key={key}><span>{label}</span><strong>{current.normalizedMetrics[key]?.toLocaleString?.() ?? '—'}</strong></div>)}</div>{saveRate !== undefined && <div className="rate-benchmark"><span>收藏率</span><strong>{(saveRate * 100).toFixed(2)}%</strong><Progress percent={Math.min(100, Math.round(saveRate * 1000))} showText={false} /></div>}{retrospective ? retrospective.insight ? <section className="learning-insight"><div className="learning-title"><span><IconExperiment /></span><div><small>Narraform 复盘建议</small><strong>{retrospective.insight.observation}</strong></div><Tag color="orange">{retrospective.insight.confidence === 'high' ? '较高信心' : '中等信心'}</Tag></div><p>{retrospective.insight.hypothesis}</p><div className="insight-evidence">{retrospective.insight.evidence.map((item) => <span key={item}>{item}</span>)}</div><div className="next-use"><strong>下一篇怎么用</strong><span>{retrospective.insight.recommendation}</span></div>{approvedRule && <div className="approved-rule-editor"><Input value={ruleDraft} onChange={setRuleDraft} disabled={approvedRule.status === 'inactive'} aria-label="编辑创作经验" /><div><Button onClick={() => updateApprovedRule({ rule: ruleDraft })} disabled={approvedRule.status === 'inactive' || !ruleDraft.trim()}>更新经验</Button><Button status="danger" onClick={() => updateApprovedRule({ status: 'inactive' })} disabled={approvedRule.status === 'inactive'}>{approvedRule.status === 'inactive' ? '已停用' : '停用'}</Button></div></div>}<div className="insight-decisions">{retrospective.insight.status === 'approved' ? <span className="approved-rule"><IconCheckCircleFill /> {approvedRule?.status === 'inactive' ? '这条经验已停用' : '已用于下次创作'}</span> : <><Button onClick={async () => { await request(`/api/learning-rules/${retrospective.insight.insightId}/dismiss`, { method: 'POST' }); setRetrospective((value) => ({ ...value, insight: { ...value.insight, status: 'dismissed' } })); }}>忽略</Button><Button type="primary" icon={<IconCheck />} onClick={approve}>用于下次创作</Button></>}</div></section> : <Alert type="info" content={`目前只有 ${retrospective.baseline.sampleSize} 条同类样本。至少需要 5 条才会生成趋势建议，当前只展示原始数据。`} /> : <div className="review-callout"><IconExperiment /><strong>生成一次有依据的复盘</strong><span>系统会寻找同平台、同目标、同类型的内容作为基线，不会跨平台混比。</span><Button type="primary" loading={loading} onClick={generateReview}>生成复盘</Button></div>}<div className="causality-note"><IconInfoCircle /><span>复盘只表达相关性信号，不会把一次表现直接写成因果规律。</span></div></> : <div className="review-callout"><IconCalendar /><strong>先补充发布表现</strong><span>可以录入曝光、阅读、点赞、收藏、评论和分享。没有的指标保持空白，不会按 0 处理。</span><Button type="primary" onClick={() => setMetricOpen(true)}>补充表现数据</Button></div>}</aside>
    </div>}
    <Modal title="补充这篇内容的表现" visible={metricOpen} onCancel={() => setMetricOpen(false)} onOk={saveMetrics} okText="保存并复盘" okButtonProps={{ loading }}><div className="metric-form"><Alert type="info" content="只填写平台实际提供的数据。留空表示缺失，不会按 0 计算。" />{[['曝光','impressions'],['阅读','reads'],['点赞','likes'],['收藏','saves'],['评论','comments'],['分享','shares']].map(([label,key]) => <label key={key}><span>{label}</span><Input value={metrics[key]} onChange={(value) => setMetrics((currentValue) => ({ ...currentValue, [key]: value.replace(/\D/g, '') }))} placeholder="未提供可留空" /></label>)}</div></Modal>
  </section>;
}
