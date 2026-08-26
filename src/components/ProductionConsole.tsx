import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CreditCard, Database, ExternalLink, FileText, LogOut, Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react';

type Organization = { id: string; name: string; role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' };
type User = { id: string; email: string; username: string; organizations: Organization[] };
type ApiError = { error?: { message?: string } };

const api = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (init.method && init.method !== 'GET') headers.set('idempotency-key', crypto.randomUUID());
  const response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'same-origin' });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({})) as T & ApiError;
  if (!response.ok) throw new Error(body.error?.message || '请求失败');
  return body;
};

const Panel = ({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) => <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center gap-2 font-semibold text-slate-900">{icon}{title}</div>{children}</section>;

export function ProductionConsole() {
  const [user, setUser] = useState<User>();
  const [organizationId, setOrganizationId] = useState<string>();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [message, setMessage] = useState<string>();
  const [ledger, setLedger] = useState<{ balance: number; held: number; available: number; entries: any[] }>();
  const [sites, setSites] = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const organization = useMemo(() => user?.organizations.find((item) => item.id === organizationId), [organizationId, user]);
  const loadWorkspace = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const [ledgerResponse, sitesResponse, snapshotResponse] = await Promise.all([
        api<{ balance: number; held: number; available: number; entries: any[] }>(`/organizations/${id}/ledger`),
        api<{ sites: any[] }>(`/organizations/${id}/sites`),
        api<{ snapshots: any[] }>(`/organizations/${id}/data-snapshots`)
      ]);
      setLedger(ledgerResponse); setSites(sitesResponse.sites); setSnapshots(snapshotResponse.snapshots); setMessage(undefined);
    } catch (error) { setMessage(error instanceof Error ? error.message : '工作区加载失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    api<{ user: User }>('/auth/me').then(({ user }) => { setUser(user); setOrganizationId(user.organizations[0]?.id); }).catch(() => undefined);
  }, []);
  useEffect(() => { if (organizationId) void loadWorkspace(organizationId); }, [organizationId, loadWorkspace]);

  const authenticate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    try {
      const payload = mode === 'login'
        ? { identifier: form.get('identifier'), password: form.get('password') }
        : { email: form.get('email'), username: form.get('username'), password: form.get('password'), organizationName: form.get('organizationName') };
      const response = await api<{ user: User }>(`/auth/${mode === 'login' ? 'login' : 'register'}`, { method: 'POST', body: JSON.stringify(payload) });
      setUser(response.user); setOrganizationId(response.user.organizations[0]?.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : '登录失败'); }
    finally { setLoading(false); }
  };

  const addSite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!organizationId) return;
    const form = new FormData(event.currentTarget);
    try {
      await api(`/organizations/${organizationId}/sites`, { method: 'POST', body: JSON.stringify({ domain: form.get('domain'), name: form.get('name'), language: form.get('language') || 'zh-CN' }) });
      event.currentTarget.reset(); await loadWorkspace(organizationId);
    } catch (error) { setMessage(error instanceof Error ? error.message : '添加站点失败'); }
  };

  const createPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!organizationId) return;
    const form = new FormData(event.currentTarget);
    try {
      const response = await api<{ paymentIntent: { recipientAddress: string; expectedAmountUsdt: string; expiresAt: string } }>(`/organizations/${organizationId}/payment-intents`, { method: 'POST', body: JSON.stringify({ amountUsdt: form.get('amountUsdt') }) });
      setMessage(`请向 ${response.paymentIntent.recipientAddress} 转入 ${response.paymentIntent.expectedAmountUsdt} USDT（TRC20），并在到期前提交交易哈希。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '创建充值意图失败'); }
  };

  const startGscAuthorization = async () => {
    if (!organizationId) return;
    const siteUrl = window.prompt('输入已在 Google Search Console 中验证的属性 URL，例如 sc-domain:example.com');
    if (!siteUrl) return;
    try {
      const response = await api<{ authorizationUrl: string }>(`/organizations/${organizationId}/integrations/gsc/authorize?siteUrl=${encodeURIComponent(siteUrl)}`);
      window.location.assign(response.authorizationUrl);
    } catch (error) { setMessage(error instanceof Error ? error.message : '无法发起 GSC 授权'); }
  };

  if (!user) return <main className="min-h-screen bg-slate-950 px-4 py-12 text-slate-100"><div className="mx-auto max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-7 shadow-2xl"><div className="mb-6 flex items-center gap-3"><ShieldCheck className="h-8 w-8 text-emerald-400"/><div><h1 className="text-xl font-bold">AISEO 生产工作区</h1><p className="text-sm text-slate-400">真实数据 · 可审计积分 · 人工发布</p></div></div>{message && <p className="mb-4 rounded-lg bg-rose-950/50 p-3 text-sm text-rose-200">{message}</p>}<form onSubmit={authenticate} className="space-y-3">{mode === 'login' ? <><input name="identifier" required placeholder="邮箱或用户名" className="w-full rounded-lg border border-slate-700 bg-slate-800 p-3"/></> : <><input name="email" type="email" required placeholder="邮箱" className="w-full rounded-lg border border-slate-700 bg-slate-800 p-3"/><input name="username" required minLength={3} placeholder="用户名" className="w-full rounded-lg border border-slate-700 bg-slate-800 p-3"/><input name="organizationName" required placeholder="组织名称" className="w-full rounded-lg border border-slate-700 bg-slate-800 p-3"/></>}<input name="password" type="password" required minLength={12} placeholder="至少 12 位密码" className="w-full rounded-lg border border-slate-700 bg-slate-800 p-3"/><button disabled={loading} className="w-full rounded-lg bg-emerald-500 p-3 font-bold text-slate-950 disabled:opacity-50">{loading ? '处理中…' : mode === 'login' ? '安全登录' : '创建组织工作区'}</button></form><button className="mt-4 w-full text-sm text-emerald-300" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? '没有账号？创建组织' : '已有账号？登录'}</button></div></main>;

  return <main className="min-h-screen bg-slate-50 text-slate-900"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4"><div><h1 className="font-bold">AISEO · {organization?.name || '选择工作区'}</h1><p className="text-xs text-slate-500">{user.email} · {organization?.role}</p></div><div className="flex items-center gap-2"><select value={organizationId || ''} onChange={(event) => setOrganizationId(event.target.value)} className="rounded-lg border border-slate-300 p-2 text-sm">{user.organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button aria-label="刷新" onClick={() => organizationId && void loadWorkspace(organizationId)} className="rounded-lg border border-slate-300 p-2"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}/></button><button aria-label="退出登录" onClick={() => api('/auth/logout', { method: 'POST' }).then(() => { setUser(undefined); setLedger(undefined); })} className="rounded-lg border border-slate-300 p-2"><LogOut className="h-4 w-4"/></button></div></div></header><div className="mx-auto max-w-6xl space-y-5 px-5 py-6">{message && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{message}</div>}<div className="grid gap-5 md:grid-cols-3"><Panel title="可用积分" icon={<CreditCard className="h-5 w-5 text-emerald-600"/>}><p className="text-3xl font-bold">{ledger?.available ?? '—'}</p><p className="mt-1 text-sm text-slate-500">余额 {ledger?.balance ?? '—'} · 预占 {ledger?.held ?? '—'}</p></Panel><Panel title="真实数据" icon={<Database className="h-5 w-5 text-indigo-600"/>}><p className="text-3xl font-bold">{snapshots.length}</p><p className="mt-1 text-sm text-slate-500">每条数据均显示来源与采集时间</p></Panel><Panel title="发布策略" icon={<ShieldCheck className="h-5 w-5 text-sky-600"/>}><p className="font-semibold">人工审核必需</p><p className="mt-1 text-sm text-slate-500">未通过质量门禁不会进入 WordPress</p></Panel></div><div className="grid gap-5 lg:grid-cols-2"><Panel title="站点" icon={<Plus className="h-5 w-5 text-emerald-600"/>}><form onSubmit={addSite} className="mb-4 grid gap-2 sm:grid-cols-3"><input name="domain" required placeholder="example.com" className="rounded-lg border p-2 text-sm"/><input name="name" required placeholder="站点名称" className="rounded-lg border p-2 text-sm"/><button className="rounded-lg bg-slate-900 p-2 text-sm font-semibold text-white">添加站点</button></form><div className="space-y-2">{sites.length ? sites.map((site) => <div key={site.id} className="flex justify-between rounded-lg bg-slate-50 p-3 text-sm"><span>{site.name} · {site.domain}</span><span className={site.wordpressConfigured ? 'text-emerald-700' : 'text-amber-700'}>{site.wordpressConfigured ? 'WordPress 已配置' : '仅数据模式'}</span></div>) : <p className="text-sm text-slate-500">尚未接入站点。</p>}</div></Panel><Panel title="数据与充值" icon={<Activity className="h-5 w-5 text-indigo-600"/>}><div className="flex flex-wrap gap-2"><button onClick={startGscAuthorization} className="rounded-lg border border-indigo-300 px-3 py-2 text-sm text-indigo-700">连接 GSC <ExternalLink className="ml-1 inline h-3 w-3"/></button><form onSubmit={createPayment} className="flex gap-2"><input name="amountUsdt" inputMode="decimal" required placeholder="USDT" className="w-24 rounded-lg border p-2 text-sm"/><button className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">创建充值</button></form></div><div className="mt-4 space-y-2">{snapshots.slice(0, 4).map((snapshot) => <div key={snapshot.id} className="rounded-lg bg-slate-50 p-3 text-xs"><strong>{snapshot.provenance.source}</strong> · {snapshot.provenance.status} · {new Date(snapshot.provenance.fetchedAt).toLocaleString()}</div>)}{!snapshots.length && <p className="text-sm text-slate-500">连接 GSC 或启动 SERP 任务后，真实数据会显示在这里。</p>}</div></Panel></div><Panel title="积分总账" icon={<FileText className="h-5 w-5 text-slate-700"/>}><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-slate-500"><tr><th className="p-2">时间</th><th className="p-2">类型</th><th className="p-2">变动</th><th className="p-2">余额</th><th className="p-2">说明</th></tr></thead><tbody>{ledger?.entries?.map((entry) => <tr key={entry.id} className="border-t"><td className="p-2">{new Date(entry.createdAt).toLocaleString()}</td><td className="p-2">{entry.type}</td><td className="p-2">{entry.amount}</td><td className="p-2">{entry.balanceAfter}</td><td className="p-2">{entry.reason}</td></tr>)}</tbody></table>{!ledger?.entries?.length && <p className="p-3 text-sm text-slate-500">暂无已结算流水。</p>}</div></Panel></div></main>;
}
