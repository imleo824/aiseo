import React, { useRef, useState } from 'react';
import { CheckCircle2, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { createApiService } from '../services/api';
import type { WordPressSite } from '../types/seo';
import { useDialogInteraction } from '../hooks/useDialogInteraction';

export const GscConnectionModal: React.FC<{
  organizationId: string;
  site: WordPressSite;
  onClose: () => void;
  onChanged: () => Promise<void>;
}> = ({ organizationId, site, onClose, onChanged }) => {
  const [loading, setLoading] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const { dialogRef, onBackdropMouseDown } = useDialogInteraction({
    open: true,
    onClose,
    closeDisabled: loading,
    initialFocusRef: closeButton
  });

  const authorize = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const { authorizationUrl } = await createApiService(organizationId).authorizeGsc(site.id);
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
      await createApiService(organizationId).syncGsc(site.id);
      setMessage('数据同步已开始，完成后会自动更新。');
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
      setMessage('再次点击即可确认断开连接。');
      return;
    }
    setLoading(true);
    try {
      await createApiService(organizationId).disconnectGsc(site.id);
      await onChanged();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'GSC 断开失败');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" onMouseDown={onBackdropMouseDown}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="gsc-dialog-title" aria-busy={loading} tabIndex={-1} className="bg-white border border-slate-200/90 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/90 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shadow-xs">
              <Search className="w-4 h-4 text-emerald-400" />
            </div>
            <h3 id="gsc-dialog-title" className="font-bold text-slate-900 text-base">Google Search Console</h3>
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            disabled={loading}
            className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-200/60 transition cursor-pointer disabled:cursor-wait disabled:opacity-40"
            aria-label="关闭窗口"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 sm:p-6 space-y-4 text-xs sm:text-sm">
          {message && (
            <div role="status" aria-live="polite" className="rounded-xl border border-slate-200/90 bg-slate-50/90 p-3.5 text-slate-800 leading-relaxed font-medium">
              {message}
            </div>
          )}
          {site.gscConnected ? (
            <>
              <div className="rounded-xl border border-emerald-200/90 bg-emerald-50/80 p-4 text-emerald-950 space-y-1.5 shadow-2xs">
                <div className="font-bold flex items-center gap-1.5 text-sm text-emerald-900">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Google Search Console 已连接</span>
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
                <span>{loading ? '正在同步…' : '同步最新数据'}</span>
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
                  <span>已授权，正在检查数据</span>
                </div>
                <div className="font-mono text-xs text-indigo-800 break-all bg-indigo-100/60 px-2.5 py-1 rounded-lg inline-block">{site.gscPropertyId}</div>
                <div className="text-xs text-indigo-700 pt-0.5">完成首次同步后会自动显示为已连接。</div>
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
                  <p>连接后，系统可以读取 <strong>{site.domain}</strong> 的搜索曝光和点击，用来发现机会并观察效果。</p>
                  <p><strong>这不是必需项。</strong>不连接也可以正常分析和发布内容。</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void authorize()}
                disabled={loading}
                className="w-full py-3 rounded-xl bg-slate-950 hover:bg-slate-800 active:bg-slate-900 text-white font-bold disabled:opacity-50 min-h-[44px] shadow-xs cursor-pointer transition"
              >
                {loading ? '正在跳转…' : '使用 Google 账号授权'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
