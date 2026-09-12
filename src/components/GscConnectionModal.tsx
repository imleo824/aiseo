import React, { useState } from 'react';
import { CheckCircle2, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { createApiService } from '../services/api';
import type { WordPressSite } from '../types/seo';

export const GscConnectionModal: React.FC<{
  site: WordPressSite;
  onClose: () => void;
  onChanged: () => Promise<void>;
}> = ({ site, onClose, onChanged }) => {
  const [loading, setLoading] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const authorize = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const { authorizationUrl } = await createApiService().authorizeGsc(site.id);
      window.location.assign(authorizationUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'GSC 授权启动失败');
      setLoading(false);
    }
  };

  const sync = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await createApiService().syncGsc(site.id);
      setMessage('最近 28 天 GSC 数据已进入真实同步队列');
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'GSC 同步失败');
    } finally {
      setLoading(false);
    }
  };

  const disconnect = async () => {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true);
      setMessage('再次点击确认断开，已保存的 GSC OAuth 凭证将被删除');
      return;
    }
    setLoading(true);
    try {
      await createApiService().disconnectGsc(site.id);
      await onChanged();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'GSC 断开失败');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200/90 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/90 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shadow-xs">
              <Search className="w-4 h-4 text-emerald-400" />
            </div>
            <h3 className="font-bold text-slate-900 text-base">Google Search Console</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-200/60 transition cursor-pointer"
            aria-label="关闭窗口"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 sm:p-6 space-y-4 text-xs sm:text-sm">
          {message && (
            <div className="rounded-xl border border-slate-200/90 bg-slate-50/90 p-3.5 text-slate-800 leading-relaxed font-medium">
              {message}
            </div>
          )}
          {site.gscConnected ? (
            <>
              <div className="rounded-xl border border-emerald-200/90 bg-emerald-50/80 p-4 text-emerald-950 space-y-1.5 shadow-2xs">
                <div className="font-bold flex items-center gap-1.5 text-sm text-emerald-900">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>GSC 属性已成功连接</span>
                </div>
                <div className="font-mono text-xs text-emerald-800 break-all bg-emerald-100/60 px-2.5 py-1 rounded-lg inline-block">{site.gscPropertyId}</div>
                <div className="text-xs text-emerald-700 pt-0.5">上次同步：{site.gscLastSyncedAt ? new Date(site.gscLastSyncedAt).toLocaleString('zh-CN', { hour12: false }) : '尚未同步'}</div>
              </div>
              <button
                type="button"
                onClick={() => void sync()}
                disabled={loading}
                className="w-full py-3 rounded-xl bg-slate-950 hover:bg-slate-800 active:bg-slate-900 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50 min-h-[44px] shadow-xs cursor-pointer transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>{loading ? '正在同步…' : '同步最近 28 天真实数据'}</span>
              </button>
              <button
                type="button"
                onClick={() => void disconnect()}
                disabled={loading}
                className="w-full py-3 rounded-xl border border-rose-200/90 text-rose-600 hover:bg-rose-50 active:bg-rose-100 font-bold min-h-[44px] cursor-pointer transition"
              >
                {confirmDisconnect ? '确认断开 GSC 授权' : '断开 GSC'}
              </button>
            </>
          ) : site.gscStatus === 'VERIFYING' ? (
            <>
              <div className="rounded-xl border border-indigo-200/90 bg-indigo-50/80 p-4 text-indigo-950 space-y-1.5 shadow-2xs">
                <div className="font-bold flex items-center gap-1.5 text-sm text-indigo-900">
                  <RefreshCw className={`w-4 h-4 text-indigo-600 ${loading ? 'animate-spin' : ''}`} />
                  <span>OAuth 已授权，正在验证真实数据</span>
                </div>
                <div className="font-mono text-xs text-indigo-800 break-all bg-indigo-100/60 px-2.5 py-1 rounded-lg inline-block">{site.gscPropertyId}</div>
                <div className="text-xs text-indigo-700 pt-0.5">首次 28 天数据同步成功后会自动转为已连接。</div>
              </div>
              <button
                type="button"
                onClick={() => void onChanged()}
                disabled={loading}
                className="w-full py-3 rounded-xl bg-slate-950 hover:bg-slate-800 active:bg-slate-900 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50 min-h-[44px] shadow-xs cursor-pointer transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>刷新连接状态</span>
              </button>
              <button
                type="button"
                onClick={() => void sync()}
                disabled={loading}
                className="w-full py-3 rounded-xl border border-slate-200/90 hover:bg-slate-50 active:bg-slate-100 text-slate-700 font-bold min-h-[44px] cursor-pointer transition"
              >
                重试数据验证
              </button>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-blue-200/90 bg-blue-50/80 p-4 text-blue-950 flex gap-2.5 leading-relaxed">
                <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div className="space-y-1.5">
                  <p>连接后，系统会读取 <strong>{site.domain}</strong> 的真实搜索曝光、点击、查询和排名变化，用来优先发现已有机会，并在发布后验证效果。</p>
                  <p><strong>不是开始自动增长的必需条件。</strong>未连接时系统仍可完成站点分析、内容与 WordPress 发布；只是不会将结果表述为已验证的自然流量变化。</p>
                  <p>系统会自动选择匹配的已验证属性；OAuth 令牌加密保存，浏览器不会读取令牌。</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void authorize()}
                disabled={loading}
                className="w-full py-3 rounded-xl bg-slate-950 hover:bg-slate-800 active:bg-slate-900 text-white font-bold disabled:opacity-50 min-h-[44px] shadow-xs cursor-pointer transition"
              >
                {loading ? '正在跳转…' : '使用 Google OAuth 授权并自动匹配'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
