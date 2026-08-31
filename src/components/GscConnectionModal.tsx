import React, { useState } from 'react';
import { CheckCircle2, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { createApiService } from '../services/api';
import type { WordPressSite } from '../types/seo';

export const GscConnectionModal: React.FC<{ site: WordPressSite; onClose: () => void; onChanged: () => Promise<void> }> = ({ site, onClose, onChanged }) => {
  const [propertyId, setPropertyId] = useState(site.gscPropertyId || `sc-domain:${site.domain}`);
  const [loading, setLoading] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const authorize = async () => {
    setLoading(true); setMessage(null);
    try {
      const { authorizationUrl } = await createApiService().authorizeGsc(site.id, propertyId.trim());
      window.location.assign(authorizationUrl);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'GSC 授权启动失败'); setLoading(false); }
  };

  const sync = async () => {
    setLoading(true); setMessage(null);
    try { await createApiService().syncGsc(site.id); setMessage('最近 28 天 GSC 数据已进入真实同步队列'); await onChanged(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'GSC 同步失败'); }
    finally { setLoading(false); }
  };

  const disconnect = async () => {
    if (!confirmDisconnect) { setConfirmDisconnect(true); setMessage('再次点击确认断开，已保存的 GSC OAuth 凭证将被删除'); return; }
    setLoading(true);
    try { await createApiService().disconnectGsc(site.id); await onChanged(); onClose(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'GSC 断开失败'); setLoading(false); }
  };

  return <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"><div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full shadow-xl overflow-hidden"><div className="px-6 py-4 border-b border-slate-100 bg-slate-50/90 flex items-center justify-between"><div className="flex items-center gap-2"><Search className="w-4 h-4" /><h3 className="font-bold text-slate-900">Google Search Console</h3></div><button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:bg-slate-200 rounded-lg"><X className="w-5 h-5" /></button></div><div className="p-5 space-y-4 text-xs">{message && <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-700">{message}</div>}{site.gscConnected ? <><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 space-y-1"><div className="font-bold flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" />GSC 已连接</div><div className="font-mono break-all">{site.gscPropertyId}</div><div>上次同步：{site.gscLastSyncedAt ? new Date(site.gscLastSyncedAt).toLocaleString('zh-CN', { hour12: false }) : '尚未同步'}</div></div><button type="button" onClick={() => void sync()} disabled={loading} className="w-full py-2.5 rounded-xl bg-slate-950 text-white font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />同步最近 28 天真实数据</button><button type="button" onClick={() => void disconnect()} disabled={loading} className="w-full py-2.5 rounded-xl border border-rose-200 text-rose-700 font-bold">{confirmDisconnect ? '确认断开 GSC' : '断开 GSC'}</button></> : site.gscStatus === 'VERIFYING' ? <><div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-900 space-y-1"><div className="font-bold flex items-center gap-1.5"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />OAuth 已授权，正在验证真实数据</div><div className="font-mono break-all">{site.gscPropertyId}</div><div>首次 28 天数据同步成功后会自动转为已连接。</div></div><button type="button" onClick={() => void onChanged()} disabled={loading} className="w-full py-2.5 rounded-xl bg-slate-950 text-white font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"><RefreshCw className="w-3.5 h-3.5" />刷新连接状态</button><button type="button" onClick={() => void sync()} disabled={loading} className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold">重试数据验证</button></> : <><div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-900 flex gap-2"><ShieldCheck className="w-4 h-4 shrink-0" />OAuth 令牌会加密保存在数据库中，浏览器不会读取令牌。</div><label className="block font-bold text-slate-700">GSC 属性</label><input value={propertyId} onChange={(event) => setPropertyId(event.target.value)} placeholder={`sc-domain:${site.domain}`} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 font-mono" /><button type="button" onClick={() => void authorize()} disabled={loading || !propertyId.trim()} className="w-full py-2.5 rounded-xl bg-slate-950 text-white font-bold disabled:opacity-50">{loading ? '正在跳转…' : '使用 Google OAuth 授权'}</button></>}</div></div></div>;
};
