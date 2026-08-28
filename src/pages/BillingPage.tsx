import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import type { Ledger } from '../types/api';
import { useWorkspace } from '../workspace/WorkspaceContext';

type Package = { id: string; name: string; baseAmountMicros: string; creditMicros: string };
type Pricing = { packages: Package[]; actions: Array<{ action: string; name: string; creditMicros: string; description: string }> };
type PaymentIntent = { id: string; packageId: string; expectedAmountMicros?: string; expectedAmountUsdt?: string; recipientAddress: string; txHash?: string; status: string; expiresAt: string };

const micros = (value: string): string => {
  const amount = BigInt(value); const whole = amount / 1_000_000n; const fraction = (amount % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, ''); return fraction ? `${whole}.${fraction}` : whole.toString();
};

export default function BillingPage() {
  const { organization } = useWorkspace(); const client = useQueryClient(); const base = `/organizations/${organization.id}`;
  const pricing = useQuery({ queryKey: ['pricing'], queryFn: () => api.get<Pricing>('/pricing').then(({ data }) => data) });
  const ledger = useQuery({ queryKey: ['ledger', organization.id], queryFn: () => api.get<Ledger>(`${base}/ledger?limit=100`).then(({ data }) => data) });
  const intents = useQuery({ queryKey: ['payments', organization.id], queryFn: () => api.get<PaymentIntent[]>(`${base}/payment-intents`).then(({ data }) => data), refetchInterval: 15_000 });
  const [message, setMessage] = useState(''); const [hashes, setHashes] = useState<Record<string, string>>({});
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ['ledger', organization.id] }), client.invalidateQueries({ queryKey: ['payments', organization.id] })]);
  const create = useMutation({ mutationFn: (packageId: string) => api.post(`${base}/payment-intents`, { packageId }), onSuccess: async () => { setMessage('充值意图已创建，请严格按唯一六位小数金额转账。'); await refresh(); }, onError: (error) => setMessage(error instanceof Error ? error.message : '创建失败') });
  const submit = useMutation({ mutationFn: (intent: PaymentIntent) => api.post(`${base}/payment-intents/${intent.id}/submit-transaction`, { txHash: hashes[intent.id] }), onSuccess: async () => { setMessage('交易已提交，Worker 将持续核验至过期。'); await refresh(); }, onError: (error) => setMessage(error instanceof Error ? error.message : '提交失败') });
  return <section className="space-y-6"><div><h1 className="page-title">TRC20 USDT 与不可变账本</h1><p className="muted">只接受 TRC20 USDT。错误网络、错误金额与退款进入人工支持流程。</p></div><div className="grid gap-4 sm:grid-cols-3">{pricing.data?.packages.map((item) => <article className="panel" key={item.id}><h2 className="section-title">{item.name}</h2><p className="text-3xl font-bold mt-2">{micros(item.baseAmountMicros)} USDT</p><p className="muted mt-1">积分微单位：{item.creditMicros}</p><button className="primary mt-4" onClick={() => create.mutate(item.id)}>创建充值意图</button></article>)}</div>{message && <p className="panel text-cyan-200">{message}</p>}<article className="panel"><h2 className="section-title">余额</h2>{ledger.data && <div className="grid gap-4 sm:grid-cols-3 mt-4"><div><p className="muted">总余额微单位</p><p className="text-xl font-bold">{ledger.data.balanceMicros}</p></div><div><p className="muted">占用</p><p className="text-xl font-bold">{ledger.data.heldMicros}</p></div><div><p className="muted">可用</p><p className="text-xl font-bold">{ledger.data.availableMicros}</p></div></div>}</article><article className="panel space-y-3"><h2 className="section-title">充值意图</h2>{intents.data?.map((intent) => <div key={intent.id} className="rounded-xl border border-slate-800 p-4 space-y-2"><div className="flex justify-between"><strong>{intent.expectedAmountUsdt || (intent.expectedAmountMicros ? micros(intent.expectedAmountMicros) : '—')} USDT</strong><span className="status">{intent.status}</span></div><p className="break-all text-sm">地址：{intent.recipientAddress}</p><p className="muted text-sm">过期：{new Date(intent.expiresAt).toLocaleString()}</p>{intent.status === 'AWAITING_TRANSFER' && <div className="flex gap-2"><input className="field" placeholder="64 位交易哈希" value={hashes[intent.id] || ''} onChange={(event) => setHashes((current) => ({ ...current, [intent.id]: event.target.value }))} /><button className="secondary" disabled={!/^[a-fA-F0-9]{64}$/.test(hashes[intent.id] || '')} onClick={() => submit.mutate(intent)}>提交</button></div>}</div>)}</article><article className="panel"><h2 className="section-title">账本明细</h2><div className="table-wrap"><table><thead><tr><th>类型</th><th>变动</th><th>变动后余额</th><th>原因</th><th>时间</th></tr></thead><tbody>{ledger.data?.entries.map((entry) => <tr key={entry.id}><td>{entry.type}</td><td>{entry.amountMicros}</td><td>{entry.balanceAfterMicros}</td><td>{entry.reason}</td><td>{new Date(entry.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div></article></section>;
}
