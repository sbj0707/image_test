import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Command, LayoutDashboard, LogOut, MoreHorizontal, Orbit, Plus, Search, Shield, ShieldCheck, Sparkles, Trash2, Users, UserCheck, UserPlus, X } from 'lucide-react';
import './style.css';

type User = { id: number; name: string; email: string; department: string; role: string; status: string; created_at: string };
type Event = { id: number; action: string; detail: string; actor: string; created_at: string };
type Stats = { total: number; active: number; admins: number; new_this_month: number };
const roles: Record<string, string> = { admin: '管理员', member: '普通成员', viewer: '只读成员' };
const empty = { name: '', email: '', department: '', role: 'member', status: 'active' };
async function api(path: string, options: RequestInit = {}) {
  const res = await fetch('/api' + path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('session-expired'));
    throw new Error(typeof error.detail === 'string' ? error.detail : error.detail?.[0]?.msg || '请求失败，请重试');
  }
  return res.json();
}
const date = (value: string) => new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
function Logo() { return <div className="logo"><span className="logo-mark"><Orbit size={25}/></span><span>orbit<span className="logo-dot">.</span></span></div>; }
function App() {
  const [session, setSession] = useState<{ username: string } | null>(null);
  const [checking, setChecking] = useState(true);
  const [login, setLogin] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [view, setView] = useState('users');
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, admins: 0, new_this_month: 0 });
  const [events, setEvents] = useState<Event[]>([]);
  const [eventTotal, setEventTotal] = useState(0);
  const [eventPage, setEventPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<User | 'new' | null>(null);
  const [form, setForm] = useState(empty);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; text: string; action: () => Promise<void> } | null>(null);
  const [toast, setToast] = useState('');
  const [help, setHelp] = useState(false);
  const [menu, setMenu] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const refresh = () => { setRevision(v => v + 1); setSelected([]); setMenu(null); };
  const notify = (message: string) => setToast(message);
  const params = new URLSearchParams({ q: query, role, status, page: String(page), page_size: String(pageSize) });

  useEffect(() => {
    api('/auth/me').then(setSession).catch(() => {}).finally(() => setChecking(false));
    const expire = () => setSession(null);
    window.addEventListener('session-expired', expire);
    return () => window.removeEventListener('session-expired', expire);
  }, []);
  useEffect(() => { const id = setTimeout(() => { setQuery(search); setPage(1); }, 280); return () => clearTimeout(id); }, [search]);
  useEffect(() => { if (toast) { const id = setTimeout(() => setToast(''), 4000); return () => clearTimeout(id); } }, [toast]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setView('users'); searchRef.current?.focus(); }
      if (e.key === 'Escape' && !busy) { setEditor(null); setConfirm(null); setHelp(false); setMenu(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [busy]);
  useEffect(() => {
    if (!session) return;
    let current = true;
    setLoading(true); setLoadError(''); setSelected([]);
    Promise.all([api('/users?' + params), api('/stats'), api(`/activities?page=${eventPage}`)])
      .then(([data, summary, log]) => {
        if (!current) return;
        if (page > 1 && !data.items.length) { setPage(1); return; }
        setUsers(data.items); setTotal(data.total); setStats(summary); setEvents(log.items); setEventTotal(log.total);
      }).catch(e => { if (current) setLoadError(e.message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [session, query, role, status, page, pageSize, revision, eventPage]);
  useEffect(() => {
    if (!(editor || confirm || help)) return;
    const prior = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>('[role="dialog"]');
    const selectors = 'button:not(:disabled), input, select, [tabindex="0"]';
    modal?.querySelector<HTMLElement>(selectors)?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !modal) return;
      const nodes = Array.from(modal.querySelectorAll<HTMLElement>(selectors));
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); prior?.focus(); };
  }, [editor, confirm, help]);

  function openEditor(user: User | 'new') { setForm(user === 'new' ? { ...empty } : { name: user.name, email: user.email, department: user.department, role: user.role, status: user.status }); setFormError(''); setEditor(user); setMenu(null); }
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setFormError('');
    try { await api(editor === 'new' ? '/users' : `/users/${(editor as User).id}`, { method: editor === 'new' ? 'POST' : 'PUT', body: JSON.stringify(form) }); setEditor(null); refresh(); notify(editor === 'new' ? '用户已创建' : '用户资料已更新'); }
    catch (e) { setFormError((e as Error).message); } finally { setBusy(false); }
  }
  async function toggle(user: User) {
    try { await api(`/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ ...user, status: user.status === 'active' ? 'disabled' : 'active' }) }); refresh(); notify(user.status === 'active' ? '用户已停用' : '用户已启用'); }
    catch (e) { notify((e as Error).message); }
  }
  function remove(user: User) {
    setMenu(null); setConfirm({ title: '删除这位用户？', text: `“${user.name}”的用户资料将永久删除，此操作无法撤销。`, action: async () => { await api(`/users/${user.id}`, { method: 'DELETE' }); refresh(); notify('用户已删除'); } });
  }
  async function bulk(action: string) {
    await api('/users/bulk', { method: 'POST', body: JSON.stringify({ ids: selected, action }) }); refresh(); notify('批量操作已完成');
  }
  async function download() {
    try {
      const res = await fetch('/api/users/export?' + params);
      if (!res.ok) throw new Error('导出失败，请重新登录后重试');
      const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = 'users.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('用户列表已导出');
    } catch (e) { notify((e as Error).message); }
  }
  const activeRate = stats.total ? Math.round(stats.active / stats.total * 100) : 0;
  const cards = [
    { label: '用户总数', value: stats.total, icon: Users, foot: '所有工作空间成员', color: 'purple' },
    { label: '正常用户', value: stats.active, icon: UserCheck, foot: `${activeRate}% 的用户处于正常状态`, color: 'green' },
    { label: '管理员', value: stats.admins, icon: ShieldCheck, foot: '标记为管理员的成员', color: 'blue' },
    { label: '本月新增', value: stats.new_this_month, icon: UserPlus, foot: '本月加入工作空间', color: 'orange' },
  ];
  if (checking) return <div className="loading-screen"><Logo/><span>正在连接工作空间…</span></div>;
  if (!session) return <div className="login-page"><div className="login-story"><Logo/><div><span className="eyebrow">YOUR PEOPLE, CONNECTED.</span><h1>让团队管理，<br/>回归简单。</h1><p>每一个出色的团队，都始于人与人的连接。<br/>在 Orbit，让你的工作空间井然有序。</p><div className="orbital-art"><div className="orbit-line one"/><div className="orbit-line two"/><div className="orbit-core"><Users size={48}/></div><span className="orbit-person a">林</span><span className="orbit-person b">陈</span><span className="orbit-person c">许</span><span className="orbit-spark"><Sparkles size={24}/></span></div></div><small>ORBIT WORKSPACE · 用户管理平台</small></div><div className="login-side"><form className="login-card" onSubmit={async e => { e.preventDefault(); setLoginBusy(true); setLoginError(''); try { setSession(await api('/auth/login', { method: 'POST', body: JSON.stringify(login) })); } catch (e) { setLoginError((e as Error).message); } finally { setLoginBusy(false); } }}><div className="login-icon"><ShieldCheck size={28}/></div><h2>欢迎回到 Orbit</h2><p>登录管理后台，连接你的团队。</p><label>管理员账号<input required autoComplete="username" placeholder="请输入账号" value={login.username} onChange={e => setLogin({ ...login, username: e.target.value })}/></label><label>密码<input required type="password" autoComplete="current-password" placeholder="请输入密码" value={login.password} onChange={e => setLogin({ ...login, password: e.target.value })}/></label>{loginError && <div className="error" role="alert">{loginError}</div>}<button className="primary login-submit" disabled={loginBusy}>{loginBusy ? '正在登录…' : '登录工作空间'}<ArrowRight size={17}/></button><div className="login-note"><Shield size={14}/> 仅限授权管理员访问</div></form><span className="login-footer">一个工作空间，无限协作可能。</span></div></div>;

  return <div className="app-shell" onClick={() => { if (menu !== null) setMenu(null); }}>
    <aside className="sidebar"><Logo/><div className="workspace"><span className="workspace-icon">O</span><div><strong>Orbit 工作空间</strong><small>团队管理控制台</small></div><span className="workspace-tag">PRO</span></div><span className="nav-caption">工作空间</span><nav>{[{ id: 'overview', label: '工作台', icon: LayoutDashboard }, { id: 'users', label: '用户管理', icon: Users }, { id: 'activity', label: '操作日志', icon: Activity }].map(item => <button key={item.id} className={view === item.id ? 'nav-item active' : 'nav-item'} onClick={() => { setView(item.id); setMenu(null); }}><item.icon size={19}/><span>{item.label}</span>{item.id === 'users' && <b>{stats.total}</b>}</button>)}</nav><div className="sidebar-bottom"><div className="tip-card"><span className="tip-symbol"><Sparkles size={20}/></span><strong>团队有序，协作自如</strong><p>在这里管理成员与角色，<br/>让每个人各得其位。</p><button onClick={() => setHelp(true)}>了解使用指南 <ArrowUpRight size={14}/></button></div><button className="help-button" onClick={() => setHelp(true)}><CircleHelp size={18}/> 帮助与支持</button><div className="profile"><span className="avatar admin-avatar">A</span><div><strong>{session.username}</strong><small>工作空间管理员</small></div><button className="icon-button" title="退出登录" aria-label="退出登录" onClick={async () => { try { await api('/auth/logout', { method: 'POST' }); setSession(null); setLogin({ username: '', password: '' }); } catch (e) { notify((e as Error).message); } }}><LogOut size={17}/></button></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">工作空间 <ChevronRight size={14}/><span>{view === 'users' ? '用户管理' : view === 'overview' ? '工作台' : '操作日志'}</span></div><div className="topbar-right"><span className="workspace-status"><i/> 工作空间已连接</span><button className="icon-button" aria-label="使用帮助" onClick={() => setHelp(true)}><CircleHelp size={19}/></button><span className="avatar small admin-avatar">A</span></div></header>
    <main><div className="page-heading"><div><div className="eyebrow">WORKSPACE / {view === 'activity' ? 'ACTIVITY' : view === 'overview' ? 'OVERVIEW' : 'PEOPLE'}</div><h1>{view === 'users' ? '用户管理' : view === 'overview' ? '工作台' : '操作日志'}<span className="heading-dot"/></h1><p>{view === 'users' ? '管理团队成员、分配角色，让协作从这里开始。' : view === 'overview' ? '你好，管理员。这里是你的团队概览。' : '每一次变更都有迹可循，掌握工作空间的最新动态。'}</p></div>{view !== 'activity' && <button className="primary" onClick={() => openEditor('new')}><Plus size={18}/> 添加用户</button>}</div>
    {loadError && <div className="error load-error" role="alert">{loadError}<button onClick={refresh}>重新加载</button></div>}
    {view !== 'activity' && <div className="stats-grid">{cards.map(c => <div className="stat-card" key={c.label}><div className="stat-top"><span>{c.label}</span><span className={'stat-icon ' + c.color}><c.icon size={19}/></span></div><div className="stat-value">{loading && !stats.total ? '—' : c.value}<span>{c.label === '本月新增' ? '位新成员' : '位成员'}</span></div><div className="stat-foot">{c.label === '正常用户' ? <i className="green-dot"/> : c.label === '本月新增' ? <ArrowUpRight size={13}/> : <span className={'mini-dot ' + c.color}/>} {c.foot}</div></div>)}</div>}
    {view === 'users' && <section className="user-panel"><div className="panel-heading"><div><h2>所有用户 <span className="count-badge">{total}</span></h2><p>团队中的每一位成员，都在这里。</p></div><button className="secondary" onClick={download}><ArrowDownToLine size={16}/> 导出用户</button></div><div className="filter-bar"><div className="search"><Search size={17}/><input ref={searchRef} aria-label="搜索用户" placeholder="搜索姓名、邮箱或部门…" value={search} onChange={e => setSearch(e.target.value)}/><kbd><Command size={10}/> K</kbd></div><div className="filter-group"><div className="select-wrap"><Shield size={15}/><select aria-label="按角色筛选" value={role} onChange={e => { setRole(e.target.value); setPage(1); }}><option value="">全部角色</option>{Object.entries(roles).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select><ChevronDown size={14}/></div><div className="select-wrap"><span className="status-filter-dot"/><select aria-label="按状态筛选" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">全部状态</option><option value="active">正常</option><option value="disabled">已停用</option></select><ChevronDown size={14}/></div>{(role || status || search) && <button className="text-button" onClick={() => { setSearch(''); setRole(''); setStatus(''); setPage(1); }}>重置</button>}</div></div>
    {selected.length > 0 && <div className="bulk-bar"><span>已选择 <strong>{selected.length}</strong> 位用户</span><button onClick={() => bulk('activate').catch(e => notify(e.message))}>批量启用</button><button onClick={() => bulk('disable').catch(e => notify(e.message))}>批量停用</button><button className="danger-text" onClick={() => setConfirm({ title: `删除 ${selected.length} 位用户？`, text: '所选用户的资料将永久删除，此操作无法撤销。', action: () => bulk('delete') })}>批量删除</button><button className="bulk-close" onClick={() => setSelected([])} aria-label="取消选择"><X size={15}/></button></div>}
    <div className="table-scroll"><table><thead><tr><th className="checkbox-cell"><input type="checkbox" aria-label="选择当前页所有用户" checked={users.length > 0 && selected.length === users.length} onChange={e => setSelected(e.target.checked ? users.map(u => u.id) : [])}/></th><th>用户信息</th><th>角色</th><th>部门</th><th>状态</th><th>创建时间</th><th className="action-cell">操作</th></tr></thead><tbody>{!loading && users.map((user, index) => <tr key={user.id} className={selected.includes(user.id) ? 'selected' : ''}><td className="checkbox-cell"><input type="checkbox" aria-label={`选择 ${user.name}`} checked={selected.includes(user.id)} onChange={e => setSelected(e.target.checked ? [...selected, user.id] : selected.filter(id => id !== user.id))}/></td><td><div className="user-info"><span className={'avatar avatar-color-' + user.id % 6}>{user.name.slice(0, 1)}</span><div><strong>{user.name}</strong><small>{user.email}</small></div></div></td><td><span className={'role-badge ' + user.role}>{user.role === 'admin' && <ShieldCheck size={12}/>} {roles[user.role]}</span></td><td className="department">{user.department || '—'}</td><td><span className={'status-badge ' + user.status}><i/>{user.status === 'active' ? '正常' : '已停用'}</span></td><td className="date-cell">{date(user.created_at)}</td><td className="action-cell"><div className="row-actions"><button className="text-button" onClick={() => openEditor(user)}>编辑</button><div className="menu-anchor"><button className="icon-button more-button" aria-label={`${user.name}的更多操作`} aria-expanded={menu === user.id} onClick={e => { e.stopPropagation(); setMenu(menu === user.id ? null : user.id); }}><MoreHorizontal size={18}/></button>{menu === user.id && <div className={'dropdown-menu ' + (index > users.length - 3 ? 'opens-up' : '')} onClick={e => e.stopPropagation()}><button onClick={() => toggle(user)}>{user.status === 'active' ? '停用用户' : '启用用户'}</button><button className="danger-text" onClick={() => remove(user)}><Trash2 size={14}/> 删除用户</button></div>}</div></div></td></tr>)}</tbody></table>{loading ? <div className="table-message"><span className="spinner"/>正在加载用户…</div> : !users.length && <div className="table-message"><Users size={32}/><strong>{query || role || status ? '没有找到匹配的用户' : '还没有团队成员'}</strong><span>尝试调整筛选条件，或添加第一位用户。</span><button className="text-button" onClick={() => openEditor('new')}>添加用户 <ArrowRight size={14}/></button></div>}</div><div className="pagination"><span>共 <strong>{total}</strong> 位用户{total > 0 && `，当前显示 ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} 位`}</span><div><select aria-label="每页显示数量" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}><option value={8}>8 条 / 页</option><option value={15}>15 条 / 页</option><option value={30}>30 条 / 页</option></select><button className="page-button" aria-label="上一页" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}><ChevronLeft size={16}/></button><span className="current-page">{page}</span><span className="page-of">/ {Math.max(1, Math.ceil(total / pageSize))}</span><button className="page-button" aria-label="下一页" disabled={page * pageSize >= total || loading} onClick={() => setPage(page + 1)}><ChevronRight size={16}/></button></div></div></section>}
    {view === 'overview' && <div className="overview-grid"><section className="overview-card"><div className="section-label"><span className="stat-icon purple"><Users size={20}/></span><h2>团队运行状态</h2></div><div className="overview-rate">{activeRate}<span>%</span></div><p>用户处于正常状态</p><div className="progress-track"><div style={{ width: activeRate + '%' }}/></div><div className="overview-counts"><span><i className="green-dot"/>正常用户 <b>{stats.active}</b></span><span><i className="gray-dot"/>已停用 <b>{stats.total - stats.active}</b></span></div><button className="secondary" onClick={() => setView('users')}>管理团队成员 <ArrowRight size={15}/></button></section><section className="overview-card recent-card"><h2>最近动态</h2><p>团队管理的每一步，都清晰可见。</p>{events.slice(0, 4).map(event => <div className="recent-event" key={event.id}><span className="event-dot"/><div><strong>{event.action}</strong><p>{event.detail}</p></div><small>{date(event.created_at)}</small></div>)}{!events.length && <p>暂无操作记录</p>}<button className="text-button" onClick={() => setView('activity')}>查看所有日志 <ArrowRight size={14}/></button></section></div>}
    {view === 'activity' && <section className="user-panel"><div className="panel-heading"><div><h2>工作空间动态 <span className="count-badge">{eventTotal}</span></h2><p>记录用户资料变更与管理员操作。</p></div><span className="audit-label"><ShieldCheck size={15}/> 操作自动记录</span></div><div className="table-scroll"><table className="activity-table"><thead><tr><th>操作类型</th><th>详细内容</th><th>操作人</th><th>操作时间</th></tr></thead><tbody>{events.map(event => <tr key={event.id}><td><span className="event-action">{event.action}</span></td><td>{event.detail}</td><td><span className="actor"><span className="avatar tiny admin-avatar">A</span>{event.actor}</span></td><td className="date-cell">{new Date(event.created_at).toLocaleString('zh-CN', { hour12: false })}</td></tr>)}</tbody></table></div><div className="pagination"><span>共 {eventTotal} 条记录</span><div><button className="page-button" aria-label="上一页日志" disabled={eventPage <= 1} onClick={() => setEventPage(eventPage - 1)}><ChevronLeft size={16}/></button><span>{eventPage} / {Math.max(1, Math.ceil(eventTotal / 15))}</span><button className="page-button" aria-label="下一页日志" disabled={eventPage * 15 >= eventTotal} onClick={() => setEventPage(eventPage + 1)}><ChevronRight size={16}/></button></div></div></section>}
    <footer className="main-footer"><span><ShieldCheck size={14}/> 团队管理，井然有序 · 每次变更都有迹可循</span><span>Orbit Workspace <span className="footer-dot">·</span> 让协作更进一步</span></footer></main></div>
    {editor && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setEditor(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="editor-title"><div className="modal-header"><div className="modal-icon"><UserPlus size={23}/></div><button className="icon-button" disabled={busy} onClick={() => setEditor(null)} aria-label="关闭"><X size={20}/></button></div><h2 id="editor-title">{editor === 'new' ? '添加新用户' : '编辑用户资料'}</h2><p>完善成员信息，为团队建立新的连接。</p><form onSubmit={save}><div className="form-grid"><label>姓名 <em>*</em><input required maxLength={80} placeholder="请输入用户姓名" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label><label>部门<input maxLength={80} placeholder="例如：产品设计" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}/></label></div><label>邮箱地址 <em>*</em><input required type="email" maxLength={254} placeholder="name@example.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}/></label><div className="form-grid"><label>用户角色<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>{Object.entries(roles).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label><label>用户状态<select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}><option value="active">正常</option><option value="disabled">已停用</option></select></label></div><div className="form-hint"><Shield size={14}/>角色用于成员分类；管理后台由独立管理员账号登录。</div>{formError && <div className="error" role="alert">{formError}</div>}<div className="modal-footer"><button type="button" className="secondary" disabled={busy} onClick={() => setEditor(null)}>取消</button><button className="primary" disabled={busy}>{busy ? '正在保存…' : editor === 'new' ? '创建用户' : '保存更改'}{!busy && <Check size={16}/>}</button></div></form></section></div>}
    {confirm && <div className="modal-backdrop"><section className="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><div className="delete-icon"><Trash2 size={24}/></div><h2 id="confirm-title">{confirm.title}</h2><p>{confirm.text}</p><div className="modal-footer"><button className="secondary" disabled={busy} onClick={() => setConfirm(null)}>取消</button><button className="danger-button" disabled={busy} onClick={async () => { setBusy(true); try { await confirm.action(); setConfirm(null); } catch (e) { notify((e as Error).message); } finally { setBusy(false); } }}>{busy ? '正在处理…' : '确认删除'}</button></div></section></div>}
    {help && <div className="modal-backdrop"><section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><div className="modal-header"><span className="modal-icon"><CircleHelp size={24}/></span><button className="icon-button" onClick={() => setHelp(false)} aria-label="关闭帮助"><X size={20}/></button></div><h2 id="help-title">Orbit 使用指南</h2><p>简单几步，开始管理你的团队。</p><ol><li><strong>添加与编辑用户</strong><p>点击“添加用户”录入姓名和邮箱；点击表格中的“编辑”修改资料。</p></li><li><strong>快速找到成员</strong><p>按姓名、邮箱或部门搜索，也可以组合角色和状态筛选。</p></li><li><strong>管理状态与批量操作</strong><p>通过行尾菜单启用、停用或删除用户，勾选多位成员后可批量操作。</p></li><li><strong>导出与追溯</strong><p>导出当前筛选下的全部用户为 CSV，在“操作日志”中查看变更记录。</p></li></ol><button className="primary" onClick={() => setHelp(false)}>开始使用 <ArrowRight size={16}/></button></section></div>}
    {toast && <div className="toast" role="status"><Check size={17}/>{toast}<button onClick={() => setToast('')} aria-label="关闭通知"><X size={14}/></button></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
