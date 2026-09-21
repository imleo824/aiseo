import React, { useRef, useState } from 'react';
import { Language, SiteType, WordPressSite } from '../types/seo';
import {
  X,
  Globe,
  Key
} from 'lucide-react';
import { useDialogInteraction } from '../hooks/useDialogInteraction';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddSite: (site: {
    domain: string;
    name: string;
    siteType?: SiteType;
    siteLanguage?: Language;
    niche?: string;
  }) => Promise<WordPressSite | void>;
  onAuthorizeWordPress: (siteId: string) => Promise<{ authorizationUrl: string }>;
  defaultLanguage: Language;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onClose,
  onAddSite,
  onAuthorizeWordPress,
  defaultLanguage
}) => {
  const [domain, setDomain] = useState('');
  const siteType: SiteType = 'WORDPRESS';
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const domainInput = useRef<HTMLInputElement>(null);
  const { dialogRef, onBackdropMouseDown } = useDialogInteraction({
    open: isOpen,
    onClose,
    closeDisabled: submitting,
    initialFocusRef: domainInput
  });

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain.trim()) return;

    setSubmitting(true);
    setError(null);
    const cleanDomain = domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');

    try {
      const site = await onAddSite({
        domain: cleanDomain,
        name: cleanDomain,
        siteType,
        siteLanguage: defaultLanguage,
        niche: undefined
      });
      if (!site) throw new Error('站点创建后未返回记录');
      const authorization = await onAuthorizeWordPress(site.id);
      window.location.assign(authorization.authorizationUrl);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : '站点保存失败，请检查配置后重试。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto" onMouseDown={onBackdropMouseDown}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="add-site-dialog-title" aria-busy={submitting} tabIndex={-1} className="bg-white border border-slate-200/90 rounded-2xl max-w-lg w-full my-auto max-h-[92dvh] flex flex-col shadow-xl animate-in zoom-in-95 duration-150">

        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 z-10 bg-white rounded-t-2xl">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-800 flex items-center justify-center">
              <Globe className="w-4 h-4 text-slate-700" />
            </div>
            <div>
              <h3 id="add-site-dialog-title" className="font-bold text-base text-slate-900">连接 WordPress</h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-slate-400 hover:text-slate-700 p-2 rounded-xl hover:bg-slate-100 transition min-h-[44px] min-w-[44px] flex items-center justify-center disabled:cursor-wait disabled:opacity-40"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 text-xs overflow-y-auto flex-1">
          {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 leading-5 text-rose-800">{error}</div>}

          {/* Domain Input */}
          <div className="space-y-1.5">
            <label htmlFor="wordpress-domain" className="font-semibold text-slate-700 flex items-center justify-between">
              <span>站点域名 <span className="text-rose-500">*</span></span>
            </label>
            <input
              ref={domainInput}
              id="wordpress-domain"
              type="text"
              inputMode="url"
              autoComplete="url"
              required
              placeholder="例如 example.com"
              value={domain}
              onChange={e => setDomain(e.target.value)}
              className="input-field"
            />
          </div>

          {/* WordPress grants credentials on the customer site; secrets are never entered here. */}
          <div className="p-3.5 bg-slate-50/80 border border-slate-200/90 rounded-xl space-y-2.5 shadow-2xs">
            <div className="font-bold text-slate-900 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-slate-700" />
                <span>安全授权</span>
              </div>
              <span className="text-[11px] text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-lg font-semibold border border-emerald-200/90">
                无需安装插件
              </span>
            </div>

            <p className="text-[11px] leading-5 text-slate-600 font-medium">
              输入域名后会跳转到您的 WordPress 确认授权。无需在这里填写 WordPress 账号或密码。
            </p>
          </div>

          {/* Footer Actions */}
          <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="btn-secondary min-h-[44px] px-4 cursor-pointer disabled:cursor-wait disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!domain.trim() || submitting}
              className="btn-primary min-h-[44px] px-5 shadow-2xs cursor-pointer"
            >
              {submitting ? '正在连接...' : '连接 WordPress'}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
