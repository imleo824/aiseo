import React, { useState } from 'react';
import { Language, SiteType } from '../types/seo';
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
    wpUsername?: string;
    wpAppPassword?: string;
    baiduToken?: string;
    niche?: string;
  }) => Promise<void>;
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
  onAddSite
}) => {
  const [domain, setDomain] = useState('');
  const [name, setName] = useState('');
  const [siteType, setSiteType] = useState<SiteType>('WORDPRESS');
  const [siteLanguage, setSiteLanguage] = useState<string>(getDefaultLanguage());
  const [wpUsername, setWpUsername] = useState('');
  const [wpAppPassword, setWpAppPassword] = useState('');
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
      await onAddSite({
        domain: cleanDomain,
        name: name.trim() || cleanDomain,
        siteType,
        siteLanguage,
        wpUsername: wpUsername.trim() || undefined,
        wpAppPassword: wpAppPassword.trim() || undefined,
        niche: niche.trim() || undefined
      });
      onClose();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : '站点保存失败，请检查配置后重试。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full my-8 max-h-[90vh] flex flex-col shadow-xl animate-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 z-10 bg-white rounded-t-2xl">
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
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition"
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
              <select
                value={siteType}
                onChange={e => setSiteType(e.target.value as SiteType)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-medium focus:outline-none focus:bg-white focus:border-slate-400 transition"
              >
                <option value="WORDPRESS">WordPress</option>
                
                
                
                
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 flex items-center gap-1.5">
                <Languages className="w-3.5 h-3.5 text-slate-500" />
                <span>站点语言</span>
              </label>
              <select
                value={siteLanguage}
                onChange={e => setSiteLanguage(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-medium focus:outline-none focus:bg-white focus:border-slate-400 transition"
              >
                <option value="zh-CN">简体中文 (zh-CN)</option>
                <option value="en-US">英语 - 美国 (en-US)</option>
                <option value="en">英语 - 通用 (en)</option>
                <option value="ja">日本语 (ja)</option>
                <option value="ko">韩语 (ko)</option>
                <option value="de">德语 (de)</option>
                <option value="fr">法语 (fr)</option>
                <option value="es">西班牙语 (es)</option>
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
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:bg-white focus:border-slate-400 transition"
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
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:bg-white focus:border-slate-400 transition"
              />
            </div>
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700">所属行业</label>
              <input
                type="text"
                value={niche}
                onChange={e => setNiche(e.target.value)}
                placeholder="例如：企业 SaaS、跨境电商"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:bg-white focus:border-slate-400 transition"
              />
            </div>
          </div>

          {/* Auth Credentials */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
            <div className="font-semibold text-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-slate-700" />
                <span>接口凭证（发布与同步）</span>
              </div>
              <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-normal border border-emerald-200">
                支持后期修改
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-slate-600 font-medium">管理员用户名</label>
                <input
                  type="text"
                  placeholder="例如：admin"
                  value={wpUsername}
                  onChange={e => setWpUsername(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-slate-600 font-medium">应用密码</label>
                <input
                  type="password"
                  placeholder="如: xxxx xxxx xxxx xxxx"
                  value={wpAppPassword}
                  onChange={e => setWpAppPassword(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-900 font-mono focus:outline-none focus:border-slate-400"
                />
              </div>
            </div>

            {siteType === 'WORDPRESS' && (
              <div className="p-2.5 bg-amber-50/80 border border-amber-200/80 rounded-lg text-[11px] text-amber-900 space-y-1">
                <div className="font-bold flex items-center gap-1 text-amber-800">
                  💡 如何获得 WordPress 应用密码？
                </div>
                <p className="leading-relaxed text-amber-900/90">
                  登录 WP 管理后台 &rarr; 导航至 <strong>「用户」&rarr;「个人资料」</strong> &rarr; 滑动至最下方 <strong>「应用密码」</strong> &rarr; 输入名称并生成，直接复制填入上框即可。
                </p>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!domain.trim() || submitting}
              className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold transition disabled:opacity-50"
            >
              {submitting ? '保存中...' : '添加站点'}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
