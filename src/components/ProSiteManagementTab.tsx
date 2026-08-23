import React, { useState } from 'react';
import { WordPressSite, SiteType } from '../types/seo';
import { 
  Plus, 
  Trash2, 
  Edit3, 
  Check, 
  Globe2,
  ExternalLink,
  CheckCircle2,
  Key,
  Layers,
  Languages,
  Zap,
  Sliders,
  X,
  Target
} from 'lucide-react';

interface ProSiteManagementTabProps {
  sites: WordPressSite[];
  onUpdateSite: (siteId: string, updated: Partial<WordPressSite>) => Promise<void>;
  onDeleteSite?: (siteId: string) => Promise<void>;
  onTestSiteConnection?: (siteId: string) => Promise<any>;
  onOpenOnboarding: () => void;
}

export const ProSiteManagementTab: React.FC<ProSiteManagementTabProps> = ({
  sites = [],
  onUpdateSite,
  onDeleteSite,
  
  onOpenOnboarding
}) => {
  const safeSites = sites || [];
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  
  const [editForm, setEditForm] = useState<{
    name: string;
    domain: string;
    niche: string;
    siteType: SiteType;
    siteLanguage: string;
    weeklyPublishCap: number;
    monthlyBudgetLimit: number;
    autopilotEnabled: boolean;
    wpUsername: string;
    wpAppPassword: string;
    baiduToken: string;
    indexNowKey: string;
    leadCtaTitle: string;
    leadCtaButton: string;
    leadCtaUrl: string;
    leadCtaEnabled: boolean;
  }>({
    name: '',
    domain: '',
    niche: '',
    siteType: 'WORDPRESS',
    siteLanguage: 'zh-CN',
    weeklyPublishCap: 2,
    monthlyBudgetLimit: 100,
    autopilotEnabled: false,
    wpUsername: '',
    wpAppPassword: '',
    baiduToken: '',
    indexNowKey: '',
    leadCtaTitle: '',
    leadCtaButton: '',
    leadCtaUrl: '',
    leadCtaEnabled: true
  });

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [activeSiteDataFilter, setActiveSiteDataFilter] = useState<'ALL' | 'ACTIVE' | 'PAUSED'>('ALL');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleStartEdit = (site: WordPressSite) => {
    setEditingSiteId(site.id);
    setEditForm({
      name: site.name || '',
      domain: site.domain || '',
      niche: site.niche || '',
      siteType: site.siteType || 'WORDPRESS',
      siteLanguage: site.siteLanguage || 'zh-CN',
      weeklyPublishCap: site.weeklyPublishCap || 2,
      monthlyBudgetLimit: site.monthlyBudgetLimit || 100,
      autopilotEnabled: site.autopilotEnabled ?? false,
      wpUsername: site.wpUsername || '',
      wpAppPassword: site.wpAppPassword || '',
      baiduToken: site.baiduToken || '',
      indexNowKey: site.indexNowKey || '',
      leadCtaTitle: site.leadCaptureCta?.title || '预约架构与技术咨询',
      leadCtaButton: site.leadCaptureCta?.buttonText || '免费预约',
      leadCtaUrl: site.leadCaptureCta?.targetUrl || `https://${site.domain}/contact`,
      leadCtaEnabled: site.leadCaptureCta?.enabled ?? true
    });
  };

  const handleSaveEdit = async (siteId: string) => {
    await onUpdateSite(siteId, {
      name: editForm.name.trim(),
      domain: editForm.domain.trim(),
      niche: editForm.niche.trim(),
      siteType: editForm.siteType,
      siteLanguage: editForm.siteLanguage,
      weeklyPublishCap: Number(editForm.weeklyPublishCap),
      monthlyBudgetLimit: Number(editForm.monthlyBudgetLimit),
      autopilotEnabled: editForm.autopilotEnabled,
      wpUsername: editForm.wpUsername.trim() || undefined,
      wpAppPassword: editForm.wpAppPassword.trim() || undefined,
      baiduToken: editForm.baiduToken.trim() || undefined,
      indexNowKey: editForm.indexNowKey.trim() || undefined,
      leadCaptureCta: {
        enabled: editForm.leadCtaEnabled,
        title: editForm.leadCtaTitle,
        buttonText: editForm.leadCtaButton,
        targetUrl: editForm.leadCtaUrl
      }
    });
    setEditingSiteId(null);
    showToast('站点全量配置已保存成功');
  };

  const handleToggleAutopilot = async (site: WordPressSite) => {
    await onUpdateSite(site.id, {
      autopilotEnabled: !site.autopilotEnabled
    });
    showToast(`托管状态已更新`);
  };

  const handleDelete = async (siteId: string) => {
    if (onDeleteSite) {
      await onDeleteSite(siteId);
      showToast('已解绑站点');
    }
  };

  const filteredSites = safeSites.filter(s => {
    if (activeSiteDataFilter === 'ACTIVE') return s.autopilotEnabled;
    if (activeSiteDataFilter === 'PAUSED') return !s.autopilotEnabled;
    return true;
  });

  const getLanguageLabel = (lang: string) => {
    switch (lang) {
      case 'zh-CN': return '🇨🇳 简体中文';
      case 'en-US': return '🇺🇸 英语(美国)';
      case 'en': return '🌐 英语(通用)';
      case 'ja': return '🇯🇵 日本语';
      case 'ko': return '🇰🇷 韩语';
      case 'de': return '🇩🇪 德语';
      case 'fr': return '🇫🇷 法语';
      case 'es': return '🇪🇸 西班牙语';
      default: return `🌐 ${lang}`;
    }
  };

  const getSiteTypeLabel = (type?: SiteType) => {
    switch (type) {
      case 'SHOPIFY': return '🛍️ Shopify';
      case 'GHOST': return '👻 Ghost';
      case 'WEBFLOW': return '🎨 Webflow';
      case 'CUSTOM_REST': return '⚡ Custom REST';
      case 'WORDPRESS':
      default:
        return '🔷 WordPress';
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6 sm:space-y-8 animate-in fade-in duration-200">
      
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-xl flex items-center space-x-2.5 text-sm font-medium animate-in fade-in slide-in-from-bottom-2 border border-slate-700">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Sites Container */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 md:p-10 shadow-sm space-y-8">
        
        {/* Header Panel */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-6">
          <div className="space-y-1.5">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-xs">
                <Globe2 className="w-5 h-5 text-emerald-400" />
              </span>
              <span>多语言独立站接入与统一管理</span>
            </h2>
          </div>

          <button
            type="button"
            onClick={onOpenOnboarding}
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-sm font-semibold transition shadow-sm flex items-center justify-center gap-2 shrink-0 active:scale-[0.99]"
          >
            <Plus className="w-4 h-4" />
            <span>接入新站点</span>
          </button>
        </div>

        {/* Filters and List */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-900">
                站点列表 ({filteredSites.length})
              </h3>
            </div>

            <div className="inline-flex p-1 bg-slate-100 rounded-xl text-xs font-medium self-start sm:self-auto">
              <button
                onClick={() => setActiveSiteDataFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  activeSiteDataFilter === 'ALL' ? 'bg-white text-slate-900 font-semibold shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                全部 ({safeSites.length})
              </button>
              <button
                onClick={() => setActiveSiteDataFilter('ACTIVE')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  activeSiteDataFilter === 'ACTIVE' ? 'bg-white text-slate-900 font-semibold shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                托管中 ({safeSites.filter(s => s.autopilotEnabled).length})
              </button>
              <button
                onClick={() => setActiveSiteDataFilter('PAUSED')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  activeSiteDataFilter === 'PAUSED' ? 'bg-white text-slate-900 font-semibold shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                已暂停 ({safeSites.filter(s => !s.autopilotEnabled).length})
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {filteredSites.map((site) => {
              return (
                <div 
                  key={site.id} 
                  className="bg-white border border-slate-200/90 hover:border-slate-300 rounded-3xl p-6 space-y-4 shadow-2xs transition"
                >
                  {/* Site Summary Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-2 min-w-0 flex-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h4 className="font-bold text-slate-900 text-base sm:text-lg">{site.name}</h4>
                        
                        {/* Site Type Badge */}
                        <span className="text-xs font-semibold text-slate-800 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg">
                          {getSiteTypeLabel(site.siteType)}
                        </span>

                        {/* Site Language Badge */}
                        <span className="text-xs text-slate-700 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg font-medium">
                          {getLanguageLabel(site.siteLanguage)}
                        </span>

                        {/* Domain Link */}
                        <a 
                          href={`https://${site.domain}`} 
                          target="_blank" 
                          rel="noreferrer"
                          className="text-xs font-mono text-slate-500 hover:text-slate-800 flex items-center gap-1 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200/80"
                        >
                          https://{site.domain}
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                        </a>
                      </div>

                      {/* Sub-meta tags */}
                      <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                        <span className="bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-md">
                          行业: {site.niche || '通用'}
                        </span>
                        <span>每周发布上限: <strong className="text-slate-800">{site.weeklyPublishCap || 2}</strong> 篇</span>
                        <span>月预算上限: <strong className="text-slate-800">${site.monthlyBudgetLimit || 100}</strong></span>
                        
                        {site.wpAppPassword ? (
                          <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md flex items-center gap-1 font-medium">
                            <Key className="w-3 h-3" />
                            凭证就绪
                          </span>
                        ) : (
                          <span className="text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md font-medium">
                            未配置密码
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      {/* Interactive Toggle Switch */}
                      <button
                        type="button"
                        onClick={() => handleToggleAutopilot(site)}
                        className={`inline-flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition border cursor-pointer select-none ${
                          site.autopilotEnabled
                            ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100 shadow-2xs'
                            : 'bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200 hover:text-slate-900'
                        }`}
                        title={site.autopilotEnabled ? '点击关闭自动执行' : '点击开启自动执行'}
                      >
                        <span className="relative flex h-2 w-2">
                          {site.autopilotEnabled && (
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          )}
                          <span className={`relative inline-flex rounded-full h-2 w-2 ${site.autopilotEnabled ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
                        </span>

                        <span>{site.autopilotEnabled ? '托管运行中' : '托管已暂停'}</span>

                        {/* Switch Slider Knob */}
                        <div className={`w-7 h-4 rounded-full p-0.5 transition-colors duration-200 ease-in-out ${site.autopilotEnabled ? 'bg-emerald-600' : 'bg-slate-300'}`}>
                          <div className={`w-3 h-3 rounded-full bg-white shadow-xs transform transition-transform duration-200 ease-in-out ${site.autopilotEnabled ? 'translate-x-3' : 'translate-x-0'}`} />
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleStartEdit(site)}
                        className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold transition flex items-center gap-1.5"
                        title="编辑站点全部配置"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-slate-600" />
                        <span>全量编辑</span>
                      </button>

                      {onDeleteSite && (
                        <button
                          type="button"
                          onClick={() => handleDelete(site.id)}
                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition"
                          title="解绑站点"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* FULL SITE EDIT MODAL DIALOG */}
      {editingSiteId && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-2xl w-full my-8 max-h-[92vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-150">
            
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/90 flex items-center justify-between sticky top-0 z-10 rounded-t-3xl">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-bold text-sm shadow-xs">
                  <Sliders className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">
                    编辑站点全量配置
                  </h3>
                  <p className="text-xs text-slate-500">
                    包括基本属性、站点类型、语言、发文策略上限与 API 密钥
                  </p>
                </div>
              </div>

              <button 
                type="button"
                onClick={() => setEditingSiteId(null)} 
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-200/60 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6 text-sm overflow-y-auto flex-1">
              
              {/* Section 1: Basic Information */}
              <div className="space-y-3">
                <div className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-100">
                  <Globe2 className="w-4 h-4 text-emerald-600" />
                  <span>1. 基础站点信息与行业语言定位</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">站点名称</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs font-semibold focus:outline-none focus:bg-white focus:border-slate-400"
                      placeholder="例如: TechPulse Media"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">绑定域名</label>
                    <input
                      type="text"
                      value={editForm.domain}
                      onChange={(e) => setEditForm({ ...editForm, domain: e.target.value })}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs font-mono focus:outline-none focus:bg-white focus:border-slate-400"
                      placeholder="例如: example.com"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  {/* Site Type */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-slate-500" />
                      <span>站点系统类型</span>
                    </label>
                    <select
                      value={editForm.siteType}
                      onChange={(e) => setEditForm({ ...editForm, siteType: e.target.value as SiteType })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs font-medium focus:outline-none focus:bg-white focus:border-slate-400"
                    >
                      <option value="WORDPRESS">🔷 WordPress (默认)</option>
                      <option value="SHOPIFY">🛍️ Shopify 独立电商</option>
                      <option value="GHOST">👻 Ghost 现代博客</option>
                      <option value="WEBFLOW">🎨 Webflow 响应式</option>
                      <option value="CUSTOM_REST">⚡ Custom REST / Webhook</option>
                    </select>
                  </div>

                  {/* Site Language */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                      <Languages className="w-3.5 h-3.5 text-slate-500" />
                      <span>站点主要语言</span>
                    </label>
                    <select
                      value={editForm.siteLanguage}
                      onChange={(e) => setEditForm({ ...editForm, siteLanguage: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs font-medium focus:outline-none focus:bg-white focus:border-slate-400"
                    >
                      <option value="zh-CN">🇨🇳 简体中文 (zh-CN)</option>
                      <option value="en-US">🇺🇸 英语 - 美国 (en-US)</option>
                      <option value="en">🌐 英语 - 通用 (en)</option>
                      <option value="ja">🇯🇵 日本语 (ja)</option>
                      <option value="ko">🇰🇷 韩语 (ko)</option>
                      <option value="de">🇩🇪 德语 (de)</option>
                      <option value="fr">🇫🇷 法语 (fr)</option>
                      <option value="es">🇪🇸 西班牙语 (es)</option>
                    </select>
                  </div>

                  {/* Niche */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">行业/业务领域</label>
                    <input
                      type="text"
                      value={editForm.niche}
                      onChange={(e) => setEditForm({ ...editForm, niche: e.target.value })}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs focus:outline-none focus:bg-white focus:border-slate-400"
                      placeholder="例如: 出海 SaaS、跨境电商"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Autopilot & Publishing Caps */}
              <div className="space-y-3">
                <div className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-100">
                  <Zap className="w-4 h-4 text-amber-500" />
                  <span>2. 自动发文策略与预算控制</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">每周发文上限 (篇)</label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={editForm.weeklyPublishCap}
                      onChange={(e) => setEditForm({ ...editForm, weeklyPublishCap: Number(e.target.value) })}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs focus:outline-none focus:bg-white focus:border-slate-400"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">月度消耗上限 ($)</label>
                    <input
                      type="number"
                      min={10}
                      value={editForm.monthlyBudgetLimit}
                      onChange={(e) => setEditForm({ ...editForm, monthlyBudgetLimit: Number(e.target.value) })}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs focus:outline-none focus:bg-white focus:border-slate-400"
                    />
                  </div>

                  <div className="space-y-1 flex flex-col justify-end">
                    <label className="text-xs font-bold text-slate-700 mb-1.5">SEO 巡航状态</label>
                    <button
                      type="button"
                      onClick={() => setEditForm({ ...editForm, autopilotEnabled: !editForm.autopilotEnabled })}
                      className={`w-full py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-between gap-1.5 border cursor-pointer ${
                        editForm.autopilotEnabled 
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-900' 
                          : 'bg-slate-100 border-slate-300 text-slate-600'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Zap className={`w-3.5 h-3.5 ${editForm.autopilotEnabled ? 'text-emerald-600 fill-emerald-600' : 'text-slate-400'}`} />
                        <span>{editForm.autopilotEnabled ? '托管运行中' : '已暂停托管'}</span>
                      </div>
                      
                      {/* Visual Switch Slider Knob */}
                      <div className={`w-7 h-4 rounded-full p-0.5 transition-colors duration-200 ease-in-out ${editForm.autopilotEnabled ? 'bg-emerald-600' : 'bg-slate-300'}`}>
                        <div className={`w-3 h-3 rounded-full bg-white shadow-xs transform transition-transform duration-200 ease-in-out ${editForm.autopilotEnabled ? 'translate-x-3' : 'translate-x-0'}`} />
                      </div>
                    </button>
                  </div>
                </div>
              </div>

              {/* Section 3: Credentials & Engine Push Tokens */}
              <div className="space-y-3">
                <div className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-100">
                  <Key className="w-4 h-4 text-blue-600" />
                  <span>3. 接口凭证与搜索引擎推送秘钥</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">账号</label>
                    <input
                      type="text"
                      placeholder="输入账号"
                      value={editForm.wpUsername}
                      onChange={(e) => setEditForm({ ...editForm, wpUsername: e.target.value })}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs focus:outline-none focus:bg-white focus:border-slate-400"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">密码</label>
                    <input
                      type="password"
                      placeholder="输入密码"
                      value={editForm.wpAppPassword}
                      onChange={(e) => setEditForm({ ...editForm, wpAppPassword: e.target.value })}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs font-mono focus:outline-none focus:bg-white focus:border-slate-400"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">百度搜索 API Token (可选)</label>
                    <input
                      type="text"
                      placeholder="如: zx89aB1234..."
                      value={editForm.baiduToken}
                      onChange={(e) => setEditForm({ ...editForm, baiduToken: e.target.value })}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs font-mono focus:outline-none focus:bg-white focus:border-slate-400"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">IndexNow Key (Bing/Yandex)</label>
                    <input
                      type="text"
                      placeholder="如: 4a2b90c1..."
                      value={editForm.indexNowKey}
                      onChange={(e) => setEditForm({ ...editForm, indexNowKey: e.target.value })}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs font-mono focus:outline-none focus:bg-white focus:border-slate-400"
                    />
                  </div>
                </div>
              </div>

              {/* Section 4: Lead Capture Component Config */}
              <div className="space-y-3">
                <div className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center justify-between pb-2 border-b border-slate-100">
                  <span className="flex items-center gap-1.5">
                    <Target className="w-4 h-4 text-purple-600" />
                    <span>4. Lead 咨询与留资转化悬浮组件 (CTA)</span>
                  </span>
                  
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-xs text-slate-500 font-normal">开启文章底部 CTA</span>
                    <input
                      type="checkbox"
                      checked={editForm.leadCtaEnabled}
                      onChange={(e) => setEditForm({ ...editForm, leadCtaEnabled: e.target.checked })}
                      className="w-4 h-4 rounded text-slate-900 focus:ring-slate-900 cursor-pointer"
                    />
                  </label>
                </div>

                {editForm.leadCtaEnabled && (
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-slate-600">CTA 模块标题</label>
                        <input
                          type="text"
                          value={editForm.leadCtaTitle}
                          onChange={(e) => setEditForm({ ...editForm, leadCtaTitle: e.target.value })}
                          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-slate-400"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-slate-600">按钮文字</label>
                        <input
                          type="text"
                          value={editForm.leadCtaButton}
                          onChange={(e) => setEditForm({ ...editForm, leadCtaButton: e.target.value })}
                          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-slate-400"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-600">跳转目标 URL</label>
                      <input
                        type="text"
                        value={editForm.leadCtaUrl}
                        onChange={(e) => setEditForm({ ...editForm, leadCtaUrl: e.target.value })}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-mono focus:outline-none focus:border-slate-400"
                      />
                    </div>
                  </div>
                )}
              </div>

            </div>

            {/* Modal Footer */}
            <div className="p-4 px-6 border-t border-slate-100 bg-slate-50/80 flex items-center justify-end gap-3 sticky bottom-0 rounded-b-3xl">
              <button
                type="button"
                onClick={() => setEditingSiteId(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 text-xs font-medium transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => handleSaveEdit(editingSiteId)}
                className="px-6 py-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-xs font-bold transition flex items-center gap-1.5 shadow-sm active:scale-95"
              >
                <Check className="w-4 h-4 text-emerald-400" />
                <span>保存全量站点配置</span>
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
