import React, { useState } from 'react';
import { WordPressSite, SiteType } from '../types/seo';
import { GscConnectionModal } from './GscConnectionModal';
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
  Sliders,
  X,
  RefreshCw
} from 'lucide-react';

interface ProSiteManagementTabProps {
  sites: WordPressSite[];
  onUpdateSite: (siteId: string, updated: Partial<WordPressSite>) => Promise<unknown>;
  onDeleteSite?: (siteId: string) => Promise<void>;
  onTestSiteConnection?: (siteId: string) => Promise<unknown>;
  onAuthorizeWordPress?: (siteId: string) => Promise<{ authorizationUrl: string }>;
  onRefreshSites?: () => Promise<void>;
  onOpenOnboarding: () => void;
}

export const ProSiteManagementTab: React.FC<ProSiteManagementTabProps> = ({
  sites = [],
  onUpdateSite,
  onDeleteSite,
  onTestSiteConnection,
  onAuthorizeWordPress,
  onRefreshSites,
  onOpenOnboarding
}) => {
  const safeSites = sites || [];
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [gscSite, setGscSite] = useState<WordPressSite | null>(null);
  const [confirmDeleteSiteId, setConfirmDeleteSiteId] = useState<string | null>(null);

  const [editForm, setEditForm] = useState<{
    name: string;
    domain: string;
    niche: string;
    siteType: SiteType;
    siteLanguage: string;
  }>({
    name: '',
    domain: '',
    niche: '',
    siteType: 'WORDPRESS',
    siteLanguage: 'zh-CN',
  });

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'error'>('success');
  const [connectionTesting, setConnectionTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const compatibilityLabel = (site: WordPressSite) => {
    switch (site.wordpressCompatibilityMode) {
      case 'FULL_AUTO': return { text: '可自动执行', className: 'text-emerald-700 bg-emerald-50' };
      case 'SAFE_AUTO': return { text: '系统将自动选择安全动作', className: 'text-blue-700 bg-blue-50' };
      case 'ANALYSIS_ONLY': return { text: '仅支持分析', className: 'text-amber-700 bg-amber-50' };
      case 'BLOCKED': return { text: '连接或权限不可用', className: 'text-rose-700 bg-rose-50' };
      default: return { text: '需要兼容检测', className: 'text-slate-700 bg-slate-100' };
    }
  };

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToastType(type);
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleStartEdit = (site: WordPressSite) => {
    setEditingSiteId(site.id);
    setEditForm({
      name: site.name || '',
      domain: site.domain || '',
      niche: site.niche || '',
      siteType: site.siteType || 'WORDPRESS',
      siteLanguage: site.siteLanguage || 'zh-CN',
    });
  };

  const handleSaveEdit = async (siteId: string) => {
    const trimmedName = editForm.name.trim();
    const rawDomain = editForm.domain.trim();

    if (!trimmedName) {
      showToast('站点名称不能为空', 'error');
      return;
    }
    if (!rawDomain) {
      showToast('绑定域名不能为空', 'error');
      return;
    }

    // Clean up domain: strip http/https protocol, trailing slashes, whitespace
    let cleanDomain = rawDomain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim().toLowerCase();

    // Standard RFC-1035 domain check
    const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,12}$/;
    if (!domainRegex.test(cleanDomain)) {
      showToast('域名格式不正确，请输入合法域名 (如: example.com)', 'error');
      return;
    }

    setIsSaving(true);
    try {
      await onUpdateSite(siteId, {
        name: trimmedName,
        domain: cleanDomain,
        niche: editForm.niche.trim() || '通用行业',
        siteType: editForm.siteType,
        siteLanguage: editForm.siteLanguage,
      });

      setEditingSiteId(null);
      showToast('站点配置已保存成功', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败，请检查网络或权限', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestWordPress = async () => {
    if (!editingSiteId || !onTestSiteConnection) return;
    setConnectionTesting(true);
    try { await onTestSiteConnection(editingSiteId); showToast('WordPress 连接与兼容能力检测完成'); }
    catch (error) { showToast(error instanceof Error ? error.message : 'WordPress 连接验证失败'); }
    finally { setConnectionTesting(false); }
  };

  const handleAuthorizeWordPress = async (siteId: string) => {
    if (!onAuthorizeWordPress) return;
    setConnectionTesting(true);
    try {
      const authorization = await onAuthorizeWordPress(siteId);
      window.location.assign(authorization.authorizationUrl);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '无法启动 WordPress 官方授权');
      setConnectionTesting(false);
    }
  };

  const handleDelete = async (siteId: string) => {
    if (confirmDeleteSiteId !== siteId) { setConfirmDeleteSiteId(siteId); showToast('再次点击“确认解绑”才会删除空站点'); return; }
    if (onDeleteSite) {
      try {
        await onDeleteSite(siteId);
        setConfirmDeleteSiteId(null);
        showToast('已解绑站点', 'success');
      } catch (error) {
        showToast(error instanceof Error ? error.message : '解绑失败，请重试', 'error');
      }
    }
  };

  const filteredSites = safeSites;

  const getLanguageLabel = (lang: string) => {
    switch (lang) {
      case 'zh-CN': return '简体中文 (zh-CN)';
      case 'en-US': return '英语 / 美国 (en-US)';
      case 'en': return '英语 / 通用 (en)';
      case 'ja': return '日语 (ja)';
      case 'ko': return '韩语 (ko)';
      case 'de': return '德语 (de)';
      case 'fr': return '法语 (fr)';
      case 'es': return '西班牙语 (es)';
      default: return lang || '默认语言';
    }
  };

  const getSiteTypeLabel = (type?: SiteType) => {
    void type;
    return 'WordPress';
  };

  const getDomainUrl = (domain: string): string => {
    if (!domain) return '#';
    const trimmed = domain.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    return `https://${trimmed}`;
  };

  const getDisplayDomain = (domain: string): string => {
    return (domain || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  };

  return (
    <div className="w-full space-y-6 sm:space-y-8 animate-in fade-in duration-200">

      {toastMessage && (
        <div className={`fixed bottom-6 right-6 z-50 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center space-x-2.5 text-xs sm:text-sm font-semibold animate-in fade-in slide-in-from-bottom-2 border ${
          toastType === 'error' ? 'bg-rose-950 border-rose-800 text-rose-100' : 'bg-slate-950 border-slate-800'
        }`}>
          {toastType === 'error' ? (
            <X className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-6 shadow-xs space-y-6">

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-center justify-between sm:justify-start gap-3 w-full sm:w-auto">
              <h3 className="text-base font-bold text-slate-900">
                站点列表 ({filteredSites.length})
              </h3>
              <button
                type="button"
                onClick={onOpenOnboarding}
                className="px-3.5 py-2 bg-slate-950 hover:bg-slate-800 active:bg-slate-900 text-white rounded-xl text-xs font-bold transition shadow-2xs flex items-center gap-1.5 cursor-pointer min-h-[38px]"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>接入新站点</span>
              </button>
            </div>
          </div>

          {filteredSites.length === 0 ? (
            <div className="p-10 sm:p-14 text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto shadow-2xs">
                <Globe2 className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-900">暂未接入任何站点</h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  接入您的网站后，系统即可开始自动化 SEO 词库拓展、质量审计与安全发布（首期支持 WordPress）。
                </p>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onOpenOnboarding}
                  className="px-4 py-2.5 bg-slate-950 hover:bg-slate-800 active:bg-slate-900 text-white rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 shadow-2xs min-h-[40px] cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>立即接入首个站点</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filteredSites.map((site) => {
                return (
                  <div
                    key={site.id}
                    className="bg-white border border-slate-200/90 rounded-xl p-4 sm:p-5 space-y-4 shadow-2xs hover:border-slate-300 transition-colors"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="space-y-2 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold text-slate-950 text-base sm:text-lg leading-tight">{site.name}</h4>

                          <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg">
                            {getSiteTypeLabel(site.siteType)}
                          </span>

                          <span className="text-xs text-slate-600 bg-slate-50 border border-slate-200/80 px-2.5 py-1 rounded-lg font-medium">
                            {getLanguageLabel(site.siteLanguage)}
                          </span>

                          <a
                            href={getDomainUrl(site.domain)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-mono text-slate-600 hover:text-slate-950 hover:bg-slate-100 flex items-center gap-1 bg-slate-50 border border-slate-200/70 px-2.5 py-1 rounded-lg transition"
                          >
                            <span>{getDisplayDomain(site.domain)}</span>
                            <ExternalLink className="w-3 h-3 text-slate-400" />
                          </a>
                        </div>

                        <div className="flex items-center gap-2.5 text-xs text-slate-500 flex-wrap pt-0.5">
                          <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg font-medium">
                            行业: {site.niche || '通用'}
                          </span>

                          {site.connectorStatus === 'CONNECTED' || site.connectorStatus === 'CHECKING' ? (
                            <span className="text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2.5 py-1 rounded-lg flex items-center gap-1 font-semibold">
                              <Key className="w-3 h-3" />
                              WordPress {site.connectorStatus === 'CONNECTED' ? '连接已验证' : '凭证待验证'}
                            </span>
                          ) : null}
                          {site.connectorStatus === 'CONNECTED' && (
                            <span className={`${compatibilityLabel(site).className} px-2.5 py-1 rounded-lg font-medium`}>
                              {compatibilityLabel(site).text}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                        <button
                          type="button"
                          onClick={() => void handleAuthorizeWordPress(site.id)}
                          disabled={connectionTesting || !onAuthorizeWordPress}
                          className={`flex-1 sm:flex-none px-3.5 py-2 rounded-xl text-xs font-bold border transition min-h-[38px] disabled:opacity-50 cursor-pointer shadow-2xs ${
                            site.connectorStatus === 'CONNECTED'
                              ? 'bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-800 border-slate-200/90'
                              : 'bg-slate-950 hover:bg-slate-800 active:bg-slate-900 text-white border-slate-950'
                          }`}
                        >
                          去授权 WordPress
                        </button>

                        <button
                          type="button"
                          onClick={() => setGscSite(site)}
                          className={`flex-1 sm:flex-none px-3.5 py-2 rounded-xl text-xs font-bold border transition min-h-[38px] cursor-pointer shadow-2xs ${
                            site.gscConnected
                              ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200/90'
                              : 'bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-800 border-slate-200/90'
                          }`}
                        >
                          {site.gscConnected ? 'GSC：已连接' : '去授权 GSC'}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleStartEdit(site)}
                          className="flex-1 sm:flex-none px-3.5 py-2 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 min-h-[38px] cursor-pointer"
                          title="编辑站点配置"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-slate-600" />
                          <span>编辑</span>
                        </button>

                        {onDeleteSite && (
                          <button
                            type="button"
                            onClick={() => handleDelete(site.id)}
                            className={`min-h-[38px] min-w-[38px] flex items-center justify-center hover:text-rose-600 hover:bg-rose-50 active:bg-rose-100 rounded-xl transition shrink-0 cursor-pointer ${
                              confirmDeleteSiteId === site.id ? 'text-rose-600 bg-rose-50 px-2.5 font-bold border border-rose-200' : 'text-slate-400'
                            }`}
                            title="解绑站点"
                            aria-label="解绑站点"
                          >
                            {confirmDeleteSiteId === site.id ? <span className="text-xs">确认解绑</span> : <Trash2 className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {editingSiteId && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200/90 rounded-2xl max-w-2xl w-full my-8 max-h-[92vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-150">

            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/90 flex items-center justify-between sticky top-0 z-10 rounded-t-2xl">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-slate-950 text-white flex items-center justify-center font-bold text-sm shadow-xs">
                  <Sliders className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">
                    编辑站点配置
                  </h3>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setEditingSiteId(null)}
                className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-200/60 transition cursor-pointer"
                aria-label="关闭配置窗口"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-6 text-sm overflow-y-auto flex-1">

              <div className="space-y-3">
                <div className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-100">
                  <Globe2 className="w-4 h-4 text-emerald-600" />
                  <span>1. 基础信息</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">站点名称</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-slate-50/80 border border-slate-200/90 rounded-xl text-slate-900 text-xs sm:text-sm font-semibold focus:outline-none focus:bg-white focus:border-slate-400 transition-colors min-h-[40px]"
                      placeholder="站点名称"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">绑定域名</label>
                    <input
                      type="text"
                      value={editForm.domain}
                      onChange={(e) => setEditForm({ ...editForm, domain: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-slate-50/80 border border-slate-200/90 rounded-xl text-slate-900 text-xs sm:text-sm font-mono focus:outline-none focus:bg-white focus:border-slate-400 transition-colors min-h-[40px]"
                      placeholder="mydomain.com"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-slate-500" />
                      <span>系统类型</span>
                    </label>
                    <div className="w-full px-3.5 py-2.5 bg-slate-100 border border-slate-200/80 rounded-xl text-slate-700 text-xs sm:text-sm font-semibold flex items-center gap-2 select-none min-h-[40px]">
                      <span className="w-2 h-2 rounded-full bg-blue-600" />
                      <span>{getSiteTypeLabel(editForm.siteType)}</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                      <Languages className="w-3.5 h-3.5 text-slate-500" />
                      <span>站点语言</span>
                    </label>
                    <select
                      value={editForm.siteLanguage}
                      onChange={(e) => setEditForm({ ...editForm, siteLanguage: e.target.value })}
                      className="w-full px-3 py-2.5 bg-slate-50/80 border border-slate-200/90 rounded-xl text-slate-900 text-xs sm:text-sm font-semibold focus:outline-none focus:bg-white focus:border-slate-400 transition-colors min-h-[40px] cursor-pointer"
                    >
                      <option value="zh-CN">🇨🇳 简体中文</option>
                      <option value="en-US">🇺🇸 英语 (美国)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">所属行业</label>
                    <input
                      type="text"
                      value={editForm.niche}
                      onChange={(e) => setEditForm({ ...editForm, niche: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-slate-50/80 border border-slate-200/90 rounded-xl text-slate-900 text-xs sm:text-sm font-medium focus:outline-none focus:bg-white focus:border-slate-400 transition-colors min-h-[40px]"
                      placeholder="行业分类"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-1.5">
                    <Key className="w-4 h-4 text-blue-600" />
                    <span>2. WordPress 授权状态</span>
                  </div>
                </div>

                <div className="p-4 bg-slate-50/80 border border-slate-200/90 rounded-xl space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/70 pb-2">
                    <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-blue-600" />
                      <span>凭证由 WordPress 官方授权流程管理，不在本页显示或编辑</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleTestWordPress()}
                      disabled={connectionTesting || !onTestSiteConnection}
                      className="px-3 py-1.5 bg-white border border-slate-200/90 hover:bg-slate-50 text-slate-700 text-xs rounded-lg font-semibold flex items-center gap-1.5 disabled:opacity-50 min-h-[32px] cursor-pointer transition shadow-2xs shrink-0 self-start sm:self-auto"
                    >
                      <RefreshCw className={`w-3 h-3 ${connectionTesting ? 'animate-spin' : ''}`} />
                      <span>{connectionTesting ? '检测中…' : '重新检测兼容性'}</span>
                    </button>
                  </div>

                  <p className="text-xs leading-relaxed text-slate-600">系统按当前 WordPress、编辑器和 SEO 插件的真实 REST 能力选择安全动作；不会安装、升级或配置客户插件。</p>
                </div>
              </div>

            </div>

            <div className="p-4 px-6 border-t border-slate-100 bg-slate-50/80 flex items-center justify-end gap-3 sticky bottom-0 rounded-b-2xl">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setEditingSiteId(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-200/90 bg-white text-slate-700 hover:bg-slate-50 active:bg-slate-100 text-xs sm:text-sm font-semibold transition min-h-[40px] cursor-pointer disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => handleSaveEdit(editingSiteId)}
                className="px-6 py-2.5 rounded-xl bg-slate-950 text-white hover:bg-slate-800 active:bg-slate-900 text-xs sm:text-sm font-bold transition flex items-center gap-1.5 shadow-xs min-h-[40px] cursor-pointer disabled:opacity-50"
              >
                {isSaving ? (
                  <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin" />
                ) : (
                  <Check className="w-4 h-4 text-emerald-400" />
                )}
                <span>{isSaving ? '正在保存…' : '保存配置'}</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {gscSite && (
        <GscConnectionModal site={gscSite} onClose={() => setGscSite(null)} onChanged={onRefreshSites || (async () => undefined)} />
      )}

    </div>
  );
};
