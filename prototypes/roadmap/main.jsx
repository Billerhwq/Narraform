import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  Dropdown,
  Input,
  Menu,
  Message,
  Progress,
  Radio,
  Tag,
  Tooltip,
} from '@arco-design/web-react';
import {
  IconApps,
  IconArchive,
  IconCalendar,
  IconCheck,
  IconCheckCircleFill,
  IconClockCircle,
  IconClose,
  IconCopy,
  IconDelete,
  IconEdit,
  IconExperiment,
  IconFile,
  IconFolder,
  IconHistory,
  IconImage,
  IconInfoCircle,
  IconLeft,
  IconLink,
  IconMore,
  IconPlus,
  IconRefresh,
  IconRight,
  IconRobot,
  IconSave,
  IconSend,
  IconSettings,
  IconThunderbolt,
  IconUpload,
} from '@arco-design/web-react/icon';
import '@arco-design/web-react/dist/css/arco.css';
import './styles.css';

const PHASES = [
  { id: 1, title: '内容引擎', nav: '开始创作', icon: <IconEdit /> },
  { id: 2, title: '素材理解', nav: '开始创作', icon: <IconFolder /> },
  { id: 3, title: '草稿发布', nav: '发布', icon: <IconSend /> },
  { id: 4, title: '反馈闭环', nav: '复盘', icon: <IconExperiment /> },
];

const navItems = [
  { name: '开始创作', icon: <IconEdit /> },
  { name: '内容', icon: <IconArchive /> },
  { name: '发布', icon: <IconSend /> },
  { name: '复盘', icon: <IconExperiment /> },
];

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark"><span>N</span></span>
      <span className="brand-name">Narraform</span>
    </div>
  );
}

function Sidebar({ phase }) {
  return (
    <aside className="sidebar">
      <Brand />
      <Button type="primary" long icon={<IconPlus />} className="create-button">新建内容</Button>
      <nav className="main-nav">
        {navItems.map((item) => (
          <button key={item.name} className={`nav-item ${PHASES[phase - 1].nav === item.name ? 'active' : ''}`}>
            {item.icon}<span>{item.name}</span>
            {item.name === '发布' && phase !== 3 ? <span className="nav-count">2</span> : null}
          </button>
        ))}
      </nav>
      <div className="sidebar-label">最近内容</div>
      <div className="recent-list">
        <button className="recent-item selected"><span>CodeLoop 产品介绍</span><small>小红书 · 刚刚</small></button>
        <button className="recent-item"><span>Agent 工具选型指南</span><small>知乎 · 昨天</small></button>
        <button className="recent-item"><span>八月版本更新</span><small>公众号 · 2 天前</small></button>
      </div>
      <div className="sidebar-bottom">
        <button className="nav-item"><IconSettings /><span>设置</span></button>
        <div className="profile"><Avatar size={28} style={{ backgroundColor: '#165dff' }}>祺</Avatar><span>个人模式</span><IconMore /></div>
      </div>
    </aside>
  );
}

function PhaseSwitch({ phase, setPhase }) {
  return (
    <div className="phase-switch" aria-label="原型阶段切换">
      {PHASES.map((item) => (
        <Tooltip key={item.id} content={`PR-0${item.id} ${item.title}`}>
          <button onClick={() => setPhase(item.id)} className={phase === item.id ? 'active' : ''}>{item.id}</button>
        </Tooltip>
      ))}
    </div>
  );
}

function Topbar({ phase, setPhase, title, subtitle, actions }) {
  return (
    <header className="topbar">
      <div className="topbar-copy">
        <div className="crumb">Narraform / PR-0{phase}</div>
        <div className="title-row"><h1>{title}</h1>{subtitle ? <span>{subtitle}</span> : null}</div>
      </div>
      <div className="top-actions"><PhaseSwitch phase={phase} setPhase={setPhase} />{actions}</div>
    </header>
  );
}

const MiniButton = ({ icon, label, onClick }) => (
  <Tooltip content={label}><Button size="small" type="text" icon={icon} onClick={onClick} aria-label={label} /></Tooltip>
);

function AssistantComposer() {
  const [value, setValue] = useState('');
  return (
    <div className="assistant-composer">
      <div className="composer-top"><IconRobot /><span>继续告诉 Narraform 怎么改</span><Tag size="small">上下文已同步</Tag></div>
      <Input.TextArea
        value={value}
        onChange={setValue}
        placeholder="例如：开头更直接一点，保留现在的事实和标题"
        autoSize={{ minRows: 2, maxRows: 4 }}
      />
      <div className="composer-actions">
        <div><MiniButton icon={<IconPlus />} label="添加资料" /><button className="plain-option">当前段落 <IconMore /></button></div>
        <Button type="primary" shape="circle" icon={<IconSend />} disabled={!value} onClick={() => { Message.success('修改指令已加入队列'); setValue(''); }} />
      </div>
    </div>
  );
}

function TitleCandidates() {
  const [selected, setSelected] = useState(0);
  const titles = ['把一段编码任务完整交给 Agent', 'CodeLoop 不只补代码，还会把任务做完', '从读仓库到跑测试，Agent 怎么工作'];
  return (
    <section className="editor-section title-section">
      <div className="section-heading"><div><span className="eyebrow">标题</span><small>选择后正文会保持一致</small></div><Button size="mini" icon={<IconRefresh />}>换一批</Button></div>
      <div className="title-options">
        {titles.map((title, index) => (
          <button key={title} className={`title-option ${selected === index ? 'selected' : ''}`} onClick={() => setSelected(index)}>
            <span className="radio-dot">{selected === index ? <IconCheck /> : null}</span><strong>{title}</strong><small>{title.length} 字</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function BodyEditor() {
  return (
    <section className="editor-section body-section">
      <div className="sticky-section-heading">
        <div><span className="eyebrow">正文</span><Tag size="small" color="arcoblue">跟随当前标题</Tag><span className="saved"><IconCheck /> 已自动保存</span></div>
        <div><MiniButton icon={<IconCopy />} label="复制正文" /><Button size="mini" icon={<IconRefresh />}>换正文</Button></div>
      </div>
      <article className="rich-editor" contentEditable suppressContentEditableWarning>
        <p>写代码时，真正耗时间的往往不只是敲下那几行，而是先读懂仓库、判断该改哪里，再确认改动没有破坏原来的逻辑。</p>
        <p>CodeLoop 想把这条链路连起来：读取你授权的代码仓库，根据目标拆出执行计划，然后修改代码并运行项目测试。你看到的不只是一段建议，而是一条可以检查的处理过程。🧩</p>
        <p>它更适合目标已经比较明确、但执行步骤多且重复的编码任务。至于速度提升、支持语言和实际效果，目前没有资料支撑，我们不会替你补上这些数字。</p>
        <p>如果有一件编码任务可以交给 Agent，你最想先交出哪一步？</p>
      </article>
      <div className="topic-row">
        {['# AI编程', '# 独立开发', '# 开发工具', '# 编码Agent', '# 效率工具'].map((topic) => <Tag key={topic} closable>{topic}</Tag>)}
        <button className="add-topic"><IconPlus /> 自定义话题</button>
      </div>
    </section>
  );
}

function EvidencePanel() {
  const [tab, setTab] = useState('facts');
  return (
    <aside className="context-panel">
      <div className="context-tabs">
        <button className={tab === 'facts' ? 'active' : ''} onClick={() => setTab('facts')}>事实</button>
        <button className={tab === 'quality' ? 'active' : ''} onClick={() => setTab('quality')}>检查 <Badge count={1} dot /></button>
        <button className={tab === 'versions' ? 'active' : ''} onClick={() => setTab('versions')}>版本</button>
      </div>
      {tab === 'facts' && <>
        <div className="panel-summary success"><IconCheckCircleFill /><div><strong>3 条主张均有来源</strong><span>没有补造数据或使用效果</span></div></div>
        <div className="panel-label">当前使用的事实</div>
        {[
          ['读取授权的代码仓库', '用户介绍 · 已确认'],
          ['把编码目标拆为执行计划', '产品说明 · 已确认'],
          ['修改代码并运行项目测试', '产品说明 · 已确认'],
        ].map(([fact, source], index) => <button className="fact-row" key={fact}><span className="fact-index">{index + 1}</span><span><strong>{fact}</strong><small>{source}</small></span><IconRight /></button>)}
        <div className="panel-label">表达边界</div>
        <div className="boundary-note"><IconInfoCircle /><span>没有速度提升、用户规模或支持语言数据，正文未使用这些表达。</span></div>
      </>}
      {tab === 'quality' && <div className="empty-detail"><IconExperiment /><strong>内容质量 92</strong><span>1 条排版建议，不阻断使用</span><Button size="small">查看建议</Button></div>}
      {tab === 'versions' && <div className="version-list">{['刚刚 · 自动保存','2 分钟前 · 换正文','8 分钟前 · 首次生成'].map((v,i)=><button key={v}><IconHistory /><span><strong>{v}</strong><small>版本 {8-i}</small></span></button>)}</div>}
    </aside>
  );
}

function PhaseOne({ phase, setPhase }) {
  return <div className="screen-shell">
    <Topbar phase={phase} setPhase={setPhase} title="CodeLoop 产品介绍" subtitle="小红书 · 产品营销" actions={<><span className="save-state"><IconCheck /> 已保存</span><Button icon={<IconSend />} type="primary">准备发布</Button></>} />
    <div className="creation-layout">
      <div className="conversation-rail">
        <div className="assistant-note"><Avatar size={26} style={{background:'#165dff'}}><IconRobot /></Avatar><div><strong>创作方向已确认</strong><p>面向独立开发者，从一条完整编码工作流解释 CodeLoop，不补造效率数据。</p><button>查看策略详情 <IconRight /></button></div></div>
        <div className="rail-label">快捷修改</div>
        {['更自然一点','缩短到 400 字','突出执行过程'].map(item=><button className="quick-prompt" key={item}><IconThunderbolt />{item}</button>)}
        <AssistantComposer />
      </div>
      <main className="document-canvas"><TitleCandidates /><BodyEditor /></main>
      <EvidencePanel />
    </div>
  </div>;
}

const sourceRows = [
  { icon: <IconImage />, name: 'codeloop-run.png', meta: '1440 × 960 · 解析完成', status: '识别 2 条观察', color: 'blue' },
  { icon: <IconFile />, name: '产品功能说明.md', meta: '12 KB · 解析完成', status: '确认 3 条事实', color: 'green' },
  { icon: <IconLink />, name: 'codeloop.dev/product', meta: '网页 · 刚刚读取', status: '发现 1 条更新', color: 'orange' },
];

function SourceItem({ row, active, onClick }) {
  return <button className={`source-item ${active ? 'active' : ''}`} onClick={onClick}>
    <span className={`source-icon ${row.color}`}>{row.icon}</span>
    <span className="source-copy"><strong>{row.name}</strong><small>{row.meta}</small></span>
    <Tag size="small" color={row.color === 'green' ? 'green' : row.color === 'orange' ? 'orange' : 'arcoblue'}>{row.status}</Tag>
    <IconMore />
  </button>;
}

function PhaseTwo({ phase, setPhase }) {
  const [source, setSource] = useState(0);
  const [filter, setFilter] = useState('all');
  return <div className="screen-shell">
    <Topbar phase={phase} setPhase={setPhase} title="整理 CodeLoop 的创作资料" subtitle="3 个来源 · 已完成分析" actions={<><Button icon={<IconUpload />}>继续添加</Button><Button type="primary" icon={<IconRight />}>用这些资料创作</Button></>} />
    <div className="materials-layout">
      <section className="material-main">
        <div className="drop-zone">
          <div className="drop-icon"><IconPlus /></div>
          <div><strong>把截图、文档或链接放在这里</strong><span>系统会区分事实、界面观察和推断，不会直接把截图内容写成产品承诺</span></div>
          <Button icon={<IconFolder />}>选择文件</Button>
        </div>
        <div className="material-section-heading"><div><h2>资料来源</h2><span>每条信息都可以回到原位置</span></div><Radio.Group type="button" size="small" value={filter} onChange={setFilter}><Radio value="all">全部</Radio><Radio value="needs">待确认 2</Radio></Radio.Group></div>
        <div className="source-list">{sourceRows.map((row,index)=><SourceItem key={row.name} row={row} active={source===index} onClick={()=>setSource(index)} />)}</div>
        <div className="facts-header"><div><h2>整理出的信息</h2><span>共 6 条 · 2 条需要你确认</span></div><span className="analysis-done"><IconCheckCircleFill /> 分析完成</span></div>
        <div className="fact-groups">
          <section className="fact-group"><div className="group-title"><span className="status-dot confirmed" />已确认事实 <b>3</b></div>
            {['CodeLoop 可以读取用户授权的代码仓库','CodeLoop 会把编码目标拆解为执行计划','CodeLoop 可以修改代码并运行项目测试'].map((t,i)=><button className="evidence-card" key={t}><Checkbox checked /><span><strong>{t}</strong><small>{i===0?'产品功能说明 · 第 2 段':'产品功能说明 · 第 3 段'}</small></span><Tag size="small" color="green">可用于文案</Tag><IconRight /></button>)}
          </section>
          <section className="fact-group"><div className="group-title"><span className="status-dot observed" />图片观察 <b>2</b></div>
            {['界面左侧显示读取仓库、修改文件和运行测试三个步骤','界面中显示 4 个文件发生改动，并展示测试通过状态'].map(t=><button className="evidence-card observed" key={t}><Checkbox /><span><strong>{t}</strong><small>codeloop-run.png · 点击查看位置</small></span><Tag size="small" color="arcoblue">待确认</Tag><IconRight /></button>)}
          </section>
        </div>
      </section>
      <aside className="source-preview">
        <div className="preview-header"><div><span className="source-icon blue"><IconImage /></span><div><strong>codeloop-run.png</strong><small>图片来源 · OCR 98%</small></div></div><MiniButton icon={<IconMore />} label="更多" /></div>
        <div className="mock-screenshot">
          <div className="shot-top"><i></i><i></i><i></i><span>CodeLoop / Run task</span></div>
          <div className="shot-body"><div className="shot-plan"><b>执行计划</b><p className="done">✓ 读取代码仓库</p><p className="active">2 修改相关文件</p><p>3 运行项目测试</p></div><div className="shot-code"><span>src/agent/runner.ts</span><pre>{`+ const plan = await agent.plan(task)\n+ await workspace.apply(plan)\n+ return testRunner.verify()`}</pre><div className="test-pass">✓ 12 tests passed</div></div></div>
          <div className="focus-box"><span>观察 1</span></div>
        </div>
        <div className="preview-detail"><span className="panel-label">当前选中内容</span><h3>界面显示一条完整执行流程</h3><p>检测到读取仓库、修改文件和运行测试三个步骤。它只能作为界面观察，确认后才用于产品文案。</p><div className="confidence"><span>提取可信度</span><strong>92%</strong></div><Progress percent={92} showText={false} size="small" />
          <div className="preview-actions"><Button icon={<IconClose />}>忽略</Button><Button type="primary" icon={<IconCheck />}>确认事实</Button></div>
        </div>
        <div className="unknown-note"><IconInfoCircle /><div><strong>仍然未知</strong><span>没有支持语言、速度提升、用户规模或价格信息。</span></div></div>
      </aside>
    </div>
  </div>;
}

const channels = [
  { id:'xhs', badge:'小', name:'小红书', detail:'图文笔记 · 4 张图', state:'ready', text:'内容已就绪' },
  { id:'zhihu', badge:'知', name:'知乎', detail:'文章 · Markdown', state:'ready', text:'内容已就绪' },
  { id:'wechat', badge:'微', name:'微信公众号', detail:'图文草稿 · 需要封面', state:'warn', text:'1 项待处理' },
];

function PhaseThree({ phase, setPhase }) {
  const [channel, setChannel] = useState('xhs');
  const [submitted, setSubmitted] = useState(false);
  return <div className="screen-shell">
    <Topbar phase={phase} setPhase={setPhase} title="保存到平台草稿" subtitle="CodeLoop 产品介绍 · 版本 8" actions={<><Button>导出内容包</Button><Button type="primary" icon={submitted?<IconCheck />:<IconSend />} onClick={()=>setSubmitted(true)}>{submitted?'任务已开始':'保存到 3 个平台草稿'}</Button></>} />
    <div className="publish-stepbar"><div className="step done"><span><IconCheck /></span><div><strong>内容确认</strong><small>版本 8 已锁定</small></div></div><i></i><div className="step active"><span>2</span><div><strong>平台适配</strong><small>检查字段与素材</small></div></div><i></i><div className="step"><span>3</span><div><strong>保存草稿</strong><small>提交并验证送达</small></div></div></div>
    <div className="publish-layout">
      <aside className="channel-list">
        <div className="channel-title"><span>发布平台</span><Tag size="small">3</Tag></div>
        {channels.map(item=><button key={item.id} className={`channel-item ${channel===item.id?'active':''}`} onClick={()=>setChannel(item.id)}><span className={`platform-badge ${item.id}`}>{item.badge}</span><span><strong>{item.name}</strong><small>{item.detail}</small></span><span className={`state ${item.state}`}><i></i>{item.text}</span></button>)}
        <button className="add-channel"><IconPlus /> 添加平台版本</button>
        <div className="delivery-note"><IconInfoCircle /><span>默认只保存草稿，不会直接公开发布。每个平台单独验证是否送达。</span></div>
      </aside>
      <main className="adaptation-editor">
        <div className="platform-heading"><div><span className="platform-badge xhs">小</span><div><h2>小红书图文笔记</h2><span>已根据平台 Spec v4 完成适配</span></div></div><span className="ready-pill"><IconCheckCircleFill /> 可以保存草稿</span></div>
        <section className="publish-field"><div className="field-heading"><label>标题</label><span>16 / 20</span></div><Input value="把一段编码任务完整交给 Agent" readOnly /><div className="field-pass"><IconCheck /> 标题长度与正文主张一致</div></section>
        <section className="publish-field body"><div className="field-heading"><label>正文</label><span>328 字</span></div><div className="publish-body">写代码时，真正耗时间的往往不只是敲下那几行，而是先读懂仓库、判断该改哪里，再确认改动没有破坏原来的逻辑。<br/><br/>CodeLoop 想把这条链路连起来：读取你授权的代码仓库，根据目标拆出执行计划，然后修改代码并运行项目测试。你看到的不只是一段建议，而是一条可以检查的处理过程。🧩<br/><br/>它更适合目标已经比较明确、但执行步骤多且重复的编码任务。</div></section>
        <section className="publish-field"><div className="field-heading"><label>话题</label><span>5 / 8</span></div><div className="topic-row compact">{['# AI编程','# 独立开发','# 开发工具','# 编码Agent','# 效率工具'].map(t=><Tag key={t}>{t}</Tag>)}</div></section>
        <section className="asset-strip"><div className="field-heading"><label>配图</label><span>4 张 · 顺序将保持</span></div><div className="asset-images">{['封面','工作流','代码改动','测试结果'].map((t,i)=><div className={`asset-thumb thumb-${i}`} key={t}><span>{i+1}</span><strong>{t}</strong>{i===0?<Tag size="small" color="arcoblue">封面</Tag>:null}</div>)}<button><IconPlus /><span>添加</span></button></div></section>
      </main>
      <aside className="preflight-panel">
        <div className="preflight-title"><div><h3>发布前检查</h3><span>最后检查于刚刚</span></div><MiniButton icon={<IconRefresh />} label="重新检查" /></div>
        <div className="check-score"><span>准备度</span><strong>100%</strong><Progress percent={100} showText={false} status="success" /></div>
        {['标题与正文一致','3 条产品主张有来源','话题数量符合要求','4 张图片可以读取'].map(t=><div className="check-row" key={t}><IconCheckCircleFill /><span>{t}</span></div>)}
        <div className="divider" />
        <div className="delivery-target"><span>保存位置</span><strong>平台草稿箱 <IconRight /></strong></div>
        <div className="delivery-target"><span>登录状态</span><strong><i className="online-dot" /> 本次会话可用</strong></div>
        {submitted ? <div className="job-progress"><div className="job-head"><IconClockCircle /><div><strong>正在保存草稿</strong><span>上传第 3 / 4 张图片</span></div><b>68%</b></div><Progress percent={68} showText={false}/><small>完成后会在平台草稿列表中反查确认</small></div> : <div className="verification-note"><IconSave /><div><strong>送达后才显示成功</strong><span>系统会反查平台草稿列表；无法确认时会标记“待检查”，不会重复提交。</span></div></div>}
      </aside>
    </div>
  </div>;
}

const weekDays = [
  { day:'周一', date:'10', items:[] },
  { day:'周二', date:'11', items:[{time:'10:30',title:'Agent 工具选型指南',platform:'知乎',tone:'blue'}] },
  { day:'周三', date:'12', items:[] },
  { day:'周四', date:'13', items:[{time:'18:20',title:'八月版本更新',platform:'公众号',tone:'green'}] },
  { day:'周五', date:'14', items:[] },
  { day:'周六', date:'15', items:[{time:'20:12',title:'CodeLoop 产品介绍',platform:'小红书',tone:'red',selected:true}] },
  { day:'周日', date:'16', items:[] },
];

function PhaseFour({ phase, setPhase }) {
  const [approved, setApproved] = useState(false);
  return <div className="screen-shell">
    <Topbar phase={phase} setPhase={setPhase} title="内容复盘" subtitle="2026 年 8 月 10 日 — 16 日" actions={<><Button icon={<IconCalendar />}>本周</Button><Button type="primary" icon={<IconPlus />}>补充表现数据</Button></>} />
    <div className="insight-summary"><div><span className="summary-icon blue"><IconSend /></span><span><small>本周已发布</small><strong>3 篇</strong></span><em>3 个平台</em></div><div><span className="summary-icon amber"><IconClockCircle /></span><span><small>等待补数据</small><strong>1 篇</strong></span><em>发布未满 24h</em></div><div><span className="summary-icon green"><IconExperiment /></span><span><small>可用经验</small><strong>2 条</strong></span><em>1 条待确认</em></div></div>
    <div className="retrospective-layout">
      <main className="calendar-area">
        <div className="calendar-toolbar"><div><Button size="small" icon={<IconLeft />} /><Button size="small" icon={<IconRight />} /><strong>8 月 10 日 — 8 月 16 日</strong><Button size="small">今天</Button></div><div className="legend"><span><i className="blue"></i>知乎</span><span><i className="green"></i>公众号</span><span><i className="red"></i>小红书</span></div></div>
        <div className="week-grid">{weekDays.map(day=><div className="day-column" key={day.date}><div className={`day-head ${day.date==='16'?'today':''}`}><span>{day.day}</span><strong>{day.date}</strong></div><div className="day-body">{day.items.map(item=><button key={item.title} className={`calendar-card ${item.tone} ${item.selected?'selected':''}`}><small>{item.time}</small><strong>{item.title}</strong><span>{item.platform} · 已发布</span>{item.selected?<em>当前复盘</em>:null}</button>)}</div></div>)}</div>
        <section className="content-timeline"><div className="timeline-title"><h2>CodeLoop 产品介绍</h2><Tag color="red" size="small">小红书</Tag><span>发布于 8 月 15 日 20:12</span><Button size="mini" type="text">查看内容 <IconRight /></Button></div><div className="timeline-steps"><div className="done"><i><IconCheck /></i><span><strong>草稿已验证</strong><small>平台草稿列表反查</small></span></div><b></b><div className="done"><i><IconCheck /></i><span><strong>已发布</strong><small>用户确认 · 8 月 15 日</small></span></div><b></b><div className="active"><i><IconExperiment /></i><span><strong>表现已收集</strong><small>48 小时数据 · 手工录入</small></span></div></div></section>
      </main>
      <aside className="performance-panel">
        <div className="performance-head"><div><span className="platform-badge xhs">小</span><div><h3>CodeLoop 产品介绍</h3><span>48 小时表现 · 数据完整</span></div></div><MiniButton icon={<IconMore />} label="更多" /></div>
        <div className="metric-primary"><span>阅读</span><strong>15,107</strong><em>高于同类中位数 18%</em></div>
        <div className="metric-grid"><div><span>点赞</span><strong>612</strong></div><div className="highlight"><span>收藏</span><strong>941</strong></div><div><span>评论</span><strong>83</strong></div><div><span>分享</span><strong>126</strong></div></div>
        <div className="benchmark"><div><span>收藏率</span><strong>6.23%</strong></div><div className="benchmark-line"><i style={{width:'76%'}}></i><mark style={{left:'43%'}}>中位数 3.41%</mark></div><small>近 30 天 · 小红书 · 同目标内容 12 篇</small></div>
        <section className="insight-card"><div className="insight-heading"><span><IconExperiment /></span><div><small>Narraform 复盘建议</small><strong>工作流结构值得继续验证</strong></div><Tag size="small" color="orange">中等信心</Tag></div><p>这篇内容的收藏率高于同类中位数。以“问题—执行流程—适用边界”组织正文，可能更方便读者保存后复用。</p><div className="evidence-chips"><span>当前 6.23%</span><span>中位数 3.41%</span><span>样本 12 篇</span></div><div className="recommendation"><strong>下一篇怎么用</strong><span>继续保留完整工作流，同时更换标题角度做一次验证。</span></div><div className="insight-actions">{approved?<span className="approved"><IconCheckCircleFill /> 已用于下次创作</span>:<><Button onClick={()=>Message.info('这条建议不会影响后续生成')}>忽略</Button><Button type="primary" icon={<IconCheck />} onClick={()=>setApproved(true)}>用于下次创作</Button></>}</div></section>
        <div className="causal-note"><IconInfoCircle /><span>这是基于同类内容的相关性观察，不代表工作流结构一定导致收藏增长。</span></div>
      </aside>
    </div>
  </div>;
}

function App() {
  const queryPhase = Number(new URLSearchParams(window.location.search).get('phase'));
  const [phase, setPhaseState] = useState(PHASES.some(p => p.id === queryPhase) ? queryPhase : 1);
  const setPhase = (next) => {
    setPhaseState(next);
    const url = new URL(window.location.href);
    url.searchParams.set('phase', next);
    window.history.replaceState({}, '', url);
  };
  const screen = useMemo(() => {
    const props = { phase, setPhase };
    if (phase === 2) return <PhaseTwo {...props} />;
    if (phase === 3) return <PhaseThree {...props} />;
    if (phase === 4) return <PhaseFour {...props} />;
    return <PhaseOne {...props} />;
  }, [phase]);
  return <div className="app-frame"><Sidebar phase={phase} />{screen}</div>;
}

createRoot(document.getElementById('root')).render(<App />);

