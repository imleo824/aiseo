import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { JobRun } from '../types/api';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';

type Metrics = { sites: number; liveSnapshots: number; openOpportunities: number; pendingDrafts: number; publishedDrafts: number; source: string; collectedAt: string };

export default function OverviewPage() {
  const { organization } = useWorkspace();
  const base = `/organizations/${organization.id}`;
  const metrics = useQuery({ queryKey: ['metrics', organization.id], queryFn: () => api.get<Metrics>(`${base}/metrics`).then(({ data }) => data) });
  const jobs = useQuery({ queryKey: ['jobs', organization.id], queryFn: () => api.get<JobRun[]>(`${base}/jobs?limit=8`).then(({ data }) => data), refetchInterval: 10_000 });
  if (metrics.error) throw metrics.error;
  const cards = metrics.data ? [['站点', metrics.data.sites], ['真实快照', metrics.data.liveSnapshots], ['开放机会', metrics.data.openOpportunities], ['待审草稿', metrics.data.pendingDrafts], ['已发布', metrics.data.publishedDrafts]] : [];
  return <section className="space-y-6"><div><h1 className="page-title">运营概览</h1><p className="muted">所有数字来自 Postgres 业务记录；未采集的供应商指标不会估算。</p></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{cards.map(([label, value]) => <article className="panel" key={label}><p className="muted text-sm">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p></article>)}</div><article className="panel"><h2 className="section-title">最近异步任务</h2><div className="table-wrap"><table><thead><tr><th>类型</th><th>状态</th><th>创建时间</th><th>错误</th></tr></thead><tbody>{jobs.data?.map((job) => <tr key={job.id}><td>{job.type}</td><td><span className="status">{job.status}</span></td><td>{new Date(job.createdAt).toLocaleString()}</td><td className="text-rose-300">{job.errorMessage || '—'}</td></tr>)}</tbody></table></div>{jobs.data?.length === 0 && <p className="empty">暂无任务</p>}</article><AccountPanel /></section>;
}

function AccountPanel() {
  const { user, signOut } = useAuth(); const [confirmEmail, setConfirmEmail] = useState(''); const [message, setMessage] = useState('');
  const download = async () => {
    try { const { data } = await api.get<unknown>('/me/export'); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `aiseo-export-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); }
    catch (error) { setMessage(error instanceof Error ? error.message : '导出失败'); }
  };
  const remove = async () => {
    try { await api.delete('/me', { confirmEmail }); await signOut(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '删除申请失败'); }
  };
  return <article className="panel space-y-3"><h2 className="section-title">数据与账号</h2><p className="muted text-sm">删除申请会立即全局撤销会话并停用独占组织，30 天后清理内容与凭证；财务和审计记录会去标识化保留。</p><div className="flex flex-wrap gap-2"><button className="secondary" onClick={() => void download()}>导出我的数据</button><input className="field !mt-0 max-w-xs" type="email" placeholder={user?.email || '确认邮箱'} value={confirmEmail} onChange={(event) => setConfirmEmail(event.target.value)} /><button className="danger" disabled={confirmEmail.toLowerCase() !== user?.email?.toLowerCase()} onClick={() => void remove()}>申请删除账号</button></div>{message && <p className="error-text">{message}</p>}</article>;
}
