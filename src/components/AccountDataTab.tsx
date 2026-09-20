import { useState } from 'react';
import { Download, ShieldAlert, Trash2 } from 'lucide-react';
import { createApiService } from '../services/api';
import type { TenantAccount } from '../types/seo';

export function AccountDataTab({ account, tenantId }: { account: TenantAccount; tenantId: string }) {
  const [confirmEmail, setConfirmEmail] = useState('');
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const exportData = async () => {
    setBusy('export');
    setMessage(null);
    try {
      const data = await createApiService(tenantId).exportPersonalData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `tuitui-personal-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
      setMessage({ type: 'success', text: '个人数据导出文件已生成。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '个人数据导出失败' });
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = async () => {
    if (confirmEmail.trim().toLowerCase() !== account.email.toLowerCase()) return;
    setBusy('delete');
    setMessage(null);
    try {
      await createApiService(tenantId).requestAccountDeletion(confirmEmail.trim());
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '账号删除请求失败' });
      setBusy(null);
    }
  };

  const deletionConfirmed = confirmEmail.trim().toLowerCase() === account.email.toLowerCase();
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs sm:p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-slate-100 p-2.5 text-slate-700"><Download className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-slate-950">导出个人数据</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">下载账号资料、组织成员关系、条款接受记录和通知的 JSON 副本。导出内容不包含加密凭证或平台密钥。</p>
            <button type="button" disabled={busy !== null} onClick={() => void exportData()} className="btn-primary mt-4 min-h-[42px] disabled:opacity-50">
              {busy === 'export' ? '正在生成…' : '下载数据副本'}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-rose-200 bg-white p-5 shadow-2xs sm:p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-rose-50 p-2.5 text-rose-700"><ShieldAlert className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-slate-950">删除账号</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">提交后会立即撤销所有登录会话并停用工作区；内容和连接凭证计划在 30 天后清理。依法需要保留的财务、安全和审计记录将按保留策略处理。</p>
            <label htmlFor="delete-confirm-email" className="mt-4 block text-xs font-semibold text-slate-700">输入当前邮箱以确认：{account.email}</label>
            <input id="delete-confirm-email" type="email" autoComplete="off" value={confirmEmail} onChange={(event) => setConfirmEmail(event.target.value)} className="input-field mt-2 max-w-md" placeholder={account.email} />
            <button type="button" disabled={!deletionConfirmed || busy !== null} onClick={() => void deleteAccount()} className="mt-3 inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-rose-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-40">
              <Trash2 className="h-4 w-4" />
              {busy === 'delete' ? '正在提交…' : '永久删除账号'}
            </button>
          </div>
        </div>
      </section>

      {message && <div role="status" className={`rounded-xl border p-3 text-sm ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{message.text}</div>}
    </div>
  );
}
