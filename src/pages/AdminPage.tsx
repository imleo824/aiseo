import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

type AdminOrganization = { id: string; name: string; creditBalanceMicros: string; disabledAt?: string; _count: { members: number; sites: number; jobs: number } };
type ProviderStatus = Record<string, boolean>;
type Payment = { id: string; status: string; expectedAmountMicros: string; txHash?: string; organization: { name: string }; createdAt: string };

export default function AdminPage() {
  const organizations = useQuery({ queryKey: ['admin', 'organizations'], queryFn: () => api.get<AdminOrganization[]>('/admin/organizations').then(({ data }) => data) });
  const payments = useQuery({ queryKey: ['admin', 'payments'], queryFn: () => api.get<Payment[]>('/admin/payments').then(({ data }) => data), refetchInterval: 15_000 });
  const providers = useQuery({ queryKey: ['admin', 'providers'], queryFn: () => api.get<ProviderStatus>('/admin/provider-status').then(({ data }) => data) });
  return <section className="space-y-6"><div><h1 className="page-title">平台管理</h1><p className="muted">只显示非敏感配置状态；供应商密钥由部署 Secret Manager 管理。</p></div><div className="grid gap-3 sm:grid-cols-3">{Object.entries(providers.data || {}).map(([name, connected]) => <article className="panel" key={name}><p className="font-semibold">{name}</p><p className={connected ? 'text-emerald-300' : 'text-amber-300'}>{connected ? '已配置' : '未配置'}</p></article>)}</div><article className="panel"><h2 className="section-title">组织</h2><div className="table-wrap"><table><thead><tr><th>组织</th><th>余额微单位</th><th>成员</th><th>站点</th><th>任务</th></tr></thead><tbody>{organizations.data?.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.creditBalanceMicros}</td><td>{item._count.members}</td><td>{item._count.sites}</td><td>{item._count.jobs}</td></tr>)}</tbody></table></div></article><article className="panel"><h2 className="section-title">最近支付</h2><div className="table-wrap"><table><thead><tr><th>组织</th><th>状态</th><th>应付微单位</th><th>交易哈希</th></tr></thead><tbody>{payments.data?.map((item) => <tr key={item.id}><td>{item.organization.name}</td><td>{item.status}</td><td>{item.expectedAmountMicros}</td><td className="max-w-56 truncate">{item.txHash || '未提交'}</td></tr>)}</tbody></table></div></article></section>;
}
