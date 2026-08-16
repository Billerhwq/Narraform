import React from 'react';
import { Button, Space, Tooltip } from '@arco-design/web-react';
import { IconDelete, IconEdit, IconExperiment, IconFile, IconHome, IconMenu, IconMore, IconPlus, IconRobot, IconSend } from '@arco-design/web-react/icon';

export function formatTime(value) {
  if (!value) return '刚刚';
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

export function Header({ section, autosaveState, onMenu, onNew }) {
  const status = autosaveState === 'saving' || autosaveState === 'pending' ? '正在自动保存' : autosaveState === 'error' ? '自动保存暂时失败' : '已自动保存';
  const names = { create: 'AI 文案助手', materials: '素材理解', history: '内容记录', publish: '平台发布', review: '内容复盘' };
  return <header className="top-command"><div className="brand-block"><span className="brand-mark"><IconRobot /></span><strong>Narraform</strong></div><div className="project-identity"><Button className="mobile-menu" type="text" icon={<IconMenu />} aria-label="打开导航" onClick={onMenu} /><div><span>{names[section] || 'Narraform'}</span><small className={`global-save-state is-${autosaveState}`}>{section === 'create' ? status : '数据按操作自动保存'}</small></div></div><Space size={8} className="top-actions">{section === 'create' && <Tooltip content="新建文案"><Button icon={<IconPlus />} aria-label="新建文案" onClick={onNew} /></Tooltip>}<Button icon={<IconMore />} aria-label="更多操作" /></Space></header>;
}

export function ProductNav({ active, contents, onChange, onNew, onOpen, onDelete, mobile = false }) {
  return <aside className={mobile ? 'product-nav mobile' : 'product-nav'} aria-label="主菜单"><Button className="new-copy-button" type="primary" long icon={<IconPlus />} onClick={onNew}>新建文案</Button><nav className="nav-primary"><button className={active === 'create' || active === 'materials' ? 'active' : ''} onClick={() => onChange('create')}><IconRobot /><span>开始创作</span></button><button className={active === 'history' ? 'active' : ''} onClick={() => onChange('history')}><IconHome /><span>内容</span></button><button className={active === 'publish' ? 'active' : ''} onClick={() => onChange('publish')}><IconSend /><span>发布</span></button><button className={active === 'review' ? 'active' : ''} onClick={() => onChange('review')}><IconExperiment /><span>复盘</span></button></nav><div className="nav-recent"><span>最近内容</span>{contents.slice(0, 4).map((item) => <div className="recent-item" key={item.id}><button className="recent-open" onClick={() => onOpen(item.id)}><IconFile /><span>{item.name}<small>{formatTime(item.updatedAt)}</small></span></button><Tooltip content="删除这条内容" position="right"><button className="recent-delete" aria-label={`删除 ${item.name}`} onClick={() => onDelete(item.id)}><IconDelete /></button></Tooltip></div>)}</div></aside>;
}

export function HistoryPage({ contents, onOpen, onNew, onDelete, onRename, platformOptions }) {
  return <section className="library-page"><div className="library-heading"><div><h1>内容记录</h1><p>查看保存的文案、版本和更新时间，继续编辑或重新使用。</p></div><Button type="primary" icon={<IconPlus />} onClick={onNew}>新建文案</Button></div>{contents.length ? <div className="library-list"><div className="library-list-head"><span>名称</span><span>平台</span><span>更新时间</span><span /></div>{contents.map((item) => <div className="library-row" key={item.id}><div className="library-name"><span className="library-icon"><IconFile /></span><span><strong>{item.name}</strong><small>{item.versionCount} 个版本 · {item.status === 'saved' ? '已保存' : item.status}</small></span></div><span>{platformOptions.find((option) => option.value === item.platform)?.label || item.platform}</span><span className="library-time">{formatTime(item.updatedAt)}</span><Space size={2}><Button type="text" onClick={() => onOpen(item.id)}>打开</Button><Tooltip content="重命名"><Button type="text" icon={<IconEdit />} aria-label="重命名" onClick={() => onRename(item)} /></Tooltip><Tooltip content="删除"><Button type="text" status="danger" icon={<IconDelete />} aria-label="删除" onClick={() => onDelete(item.id)} /></Tooltip></Space></div>)}</div> : <div className="empty-library"><IconFile /><strong>还没有保存的文案</strong><p>生成并保存文案后，会显示在这里。</p><Button type="primary" onClick={onNew}>开始创作</Button></div>}</section>;
}
