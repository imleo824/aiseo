import React, { useState } from 'react';
import { Language, SiteType, WordPressSite } from '../types/seo';
import {
  X,
  Globe,
  Key,
  Layers,
  Languages
} from 'lucide-react';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddSite: (site: {
    domain: string;
    name: string;
    siteType?: SiteType;
    siteLanguage?: Language | string;
    niche?: string;
  }) => Promise<WordPressSite | void>;
  onAuthorizeWordPress: (siteId: string) => Promise<{ authorizationUrl: string }>;
}

const getDefaultLanguage = (): string => {
  if (typeof navigator !== 'undefined' && navigator.language) {
    const lang = navigator.language.toLowerCase();
    if (lang.startsWith('zh')) return 'zh-CN';
    if (lang.startsWith('en')) return 'en-US';
  }
  return 'zh-CN';
};

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onClose,
  onAddSite,
  onAuthorizeWordPress
}) => {
  const [domain, setDomain] = useState('');
  const [name, setName] = useState('');
  const siteType: SiteType = 'WORDPRESS';
  const [siteLanguage, setSiteLanguage] = useState<string>(getDefaultLanguage());
  const [niche, setNiche] = useState('企业出海与技术服务');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        name: name.trim() || cleanDomain,
        siteType,
        siteLanguage,
        niche: niche.trim() || undefined
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
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200/90 rounded-2xl max-w-lg w-full my-auto max-h-[92dvh] flex flex-col shadow-xl animate-in zoom-in-95 duration-150">

        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 z-10 bg-white rounded-t-2xl">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-800 flex items-center justify-center">
              <Globe className="w-4 h-4 text-slate-700" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900">添加新站点</h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-2 rounded-xl hover:bg-slate-100 transition min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 text-xs overflow-y-auto flex-1">
          {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 leading-5 text-rose-800">{error}</div>}

          {/* Site Type & Language */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-500" />
                <span>站点类型</span>
              </label>
              <div className="w-full px-3 py-2.5 sm:py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-medium min-h-[44px] sm:min-h-[38px] flex items-center">WordPress (首期支持)</div>
              <p className="text-[10px] leading-4 text-slate-500">首期正式版支持 WordPress HTTPS REST API，后续将支持更多 CMS 平台。</p>
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 flex items-center gap-1.5">
                <Languages className="w-3.5 h-3.5 text-slate-500" />
                <span>站点语言</span>
              </label>
              <select
                value={siteLanguage}
                onChange={e => setSiteLanguage(e.target.value)}
                className="select-field"
              >
                <option value="zh-CN">简体中文 (zh-CN)</option>
                <option value="en-US">英语 - 美国 (en-US)</option>
              </select>
            </div>
          </div>

          {/* Domain Input */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 flex items-center justify-between">
              <span>站点域名 <span className="text-rose-500">*</span></span>
            </label>
            <input
              type="text"
              required
              placeholder="例如 example.com"
              value={domain}
              onChange={e => setDomain(e.target.value)}
              className="input-field"
            />
          </div>

          {/* Name & Niche */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700">站点名称</label>
              <input
                type="text"
                placeholder="默认使用域名"
                value={name}
                onChange={e => setName(e.target.value)}
                className="input-field"
              />
            </div>
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700">所属行业</label>
              <input
                type="text"
                value={niche}
                onChange={e => setNiche(e.target.value)}
                placeholder="例如：企业 SaaS、跨境电商"
                className="input-field"
              />
            </div>
          </div>

          {/* WordPress grants credentials on the customer site; secrets are never entered here. */}
          <div className="p-3.5 bg-slate-50/80 border border-slate-200/90 rounded-xl space-y-2.5 shadow-2xs">
            <div className="font-bold text-slate-900 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-slate-700" />
                <span>WordPress 官方授权</span>
              </div>
              <span className="text-[11px] text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-lg font-semibold border border-emerald-200/90">
                无需安装插件
              </span>
            </div>

            <p className="text-[11px] leading-5 text-slate-600 font-medium">
              点击下方按钮后会跳转到您的 WordPress 站点。批准后系统会自动识别版本、编辑器、插件公开能力及安全动作范围；凭证不会显示在浏览器中。
            </p>
          </div>

          {/* Footer Actions */}
          <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary min-h-[44px] px-4 cursor-pointer"
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
