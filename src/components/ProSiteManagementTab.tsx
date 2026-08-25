import React, { useState } from 'react';
import { WordPressSite, SiteType } from '../types/seo';
import { createApiService } from '../services/api';
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
  RefreshCw,
  Play,
  AlertTriangle
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
    wpUsername: string;
    wpAppPassword: string;
    baiduToken: string;
    googleServiceAccountJson: string;
  }>({
    name: '',
    domain: '',
    niche: '',
    siteType: 'WORDPRESS',
    siteLanguage: 'zh-CN',
    wpUsername: '',
    wpAppPassword: '',
    baiduToken: '',
    googleServiceAccountJson: '',
  });

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [engineTesting, setEngineTesting] = useState<'BAIDU' | 'GOOGLE' | null>(null);
  const [engineTestResult, setEngineTestResult] = useState<{ engine: string; success: boolean; message: string; latencyMs?: number } | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleStartEdit = (site: WordPressSite) => {
    setEditingSiteId(site.id);
    setEngineTestResult(null);
    setEditForm({
      name: site.name || '',
      domain: site.domain || '',
      niche: site.niche || '',
      siteType: site.siteType || 'WORDPRESS',
      siteLanguage: site.siteLanguage || 'zh-CN',
      wpUsername: site.wpUsername || '',
      wpAppPassword: site.wpAppPassword || '',
      baiduToken: site.baiduToken || '',
      googleServiceAccountJson: site.googleServiceAccountJson || '',
    });
  };

  const handleSaveEdit = async (siteId: string) => {
    const trimmedName = editForm.name.trim();
    const trimmedDomain = editForm.domain.trim();

    if (!trimmedName) {
      showToast('站点名称不能为空');
      return;
    }
    if (!trimmedDomain) {
      showToast('绑定域名不能为空');
      return;
    }

    // Standard RFC-1035 domain check with optional port
    const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,12}$/;
    const cleanDomain = trimmedDomain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    
    if (!domainRegex.test(cleanDomain)) {
      showToast('域名格式不正确，请不要包含 http(s):// 或路径 (如: mydomain.com)');
      return;
    }

    // If one WP credential field is entered, recommend the other is also filled
    if ((editForm.wpUsername.trim() && !editForm.wpAppPassword.trim()) || (!editForm.wpUsername.trim() && editForm.wpAppPassword.trim())) {
      showToast('配置 WordPress REST API 时，账号和应用密码必须同时提供');
      return;
    }

    await onUpdateSite(siteId, {
      name: trimmedName,
      domain: cleanDomain,
      niche: editForm.niche.trim() || '通用行业',
      siteType: editForm.siteType,
      siteLanguage: editForm.siteLanguage,
      wpUsername: editForm.wpUsername.trim() || undefined,
      wpAppPassword: editForm.wpAppPassword.trim() || undefined,
      baiduToken: editForm.baiduToken.trim() || undefined,
      googleServiceAccountJson: editForm.googleServiceAccountJson.trim() || undefined,
    });
    
    setEditingSiteId(null);
    showToast('站点配置已保存成功');
  };

  const handleTestSearchEngine = async (engineType: 'BAIDU' | 'GOOGLE') => {
    if (!editingSiteId) return;
    setEngineTesting(engineType);
    setEngineTestResult(null);

    try {
      const customParams: any = {};
      if (engineType === 'BAIDU') customParams.baiduToken = editForm.baiduToken;
      if (engineType === 'GOOGLE') customParams.googleServiceAccountJson = editForm.googleServiceAccountJson;

      const apiService = createApiService();
      const res = await apiService.testSiteSearchEngine(editingSiteId, engineType, customParams);
      setEngineTestResult(res);
    } catch (e: any) {
      setEngineTestResult({
        engine: engineType,
        success: false,
        message: e.message || '连通性测试请求失败'
      });
    } finally {
      setEngineTesting(null);
    }
  };

  const handleDelete = async (siteId: string) => {
    if (onDeleteSite) {
      await onDeleteSite(siteId);
      showToast('已解绑站点');
    }
  };

  const renderCardTestResult = (engine: 'BAIDU' | 'GOOGLE') => {
    if (!engineTestResult || engineTestResult.engine !== engine) return null;
    return (
      <div className={`p-2.5 rounded-lg text-xs border flex items-start gap-2 mt-2 animate-in fade-in duration-150 ${
        engineTestResult.success 
          ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900' 
          : 'bg-rose-50/80 border-rose-200 text-rose-900'
      }`}>
        {engineTestResult.success ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
        ) : (
          <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
        )}
        <div className="space-y-0.5 min-w-0">
          <div className="font-bold flex items-center gap-1.5 flex-wrap">
            <span>接口测试状态: {engineTestResult.success ? '测试通过' : '连接失败'}</span>
            {engineTestResult.latencyMs && (
              <span className="text-[9px] bg-white px-1 py-0.2 rounded border border-slate-200/80 text-slate-500 font-mono">
                {engineTestResult.latencyMs}ms
              </span>
            )}
          </div>
          <p className="text-[10px] opacity-90 leading-tight break-all">{engineTestResult.message}</p>
        </div>
      </div>
    );
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
    switch (type) {
      case 'SHOPIFY': return 'Shopify';
      case 'GHOST': return 'Ghost';
      case 'WEBFLOW': return 'Webflow';
      case 'CUSTOM_REST': return 'Custom REST';
      case 'WORDPRESS':
      default:
        return 'WordPress';
    }
  };

  return (
    <div className="w-full space-y-6 sm:space-y-8 animate-in fade-in duration-200">
      
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-md shadow-xl flex items-center space-x-2.5 text-sm font-medium animate-in fade-in slide-in-from-bottom-2 border border-slate-700">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200/80/80 rounded-2xl p-4 sm:p-6 shadow-sm space-y-6">

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100/60 pb-3">
            <div className="flex items-center gap-3">
              <h3 className="text-base font-bold text-slate-900">
                站点列表 ({filteredSites.length})
              </h3>
              <button
                type="button"
                onClick={onOpenOnboarding}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition shadow-xs flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>接入新站点</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {filteredSites.map((site) => {
              return (
                <div 
                  key={site.id} 
                  className="bg-white border border-slate-200/80 rounded-xl p-4 sm:p-5 space-y-4 shadow-xs transition"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-2 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-slate-900 text-base sm:text-lg">{site.name}</h4>
                        
                        <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg">
                          {getSiteTypeLabel(site.siteType)}
                        </span>

                        <span className="text-xs text-slate-600 bg-slate-50 px-2.5 py-1 rounded-lg font-medium">
                          {getLanguageLabel(site.siteLanguage)}
                        </span>

                        <a 
                          href={`https://${site.domain}`} 
                          target="_blank" 
                          rel="noreferrer"
                          className="text-xs font-mono text-slate-500 hover:text-slate-800 hover:bg-slate-100 flex items-center gap-1 bg-slate-50 px-2.5 py-1 rounded-lg transition"
                        >
                          https://{site.domain}
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                        </a>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                        <span className="bg-slate-50 px-2.5 py-0.5 rounded-md font-medium text-slate-600">
                          行业: {site.niche || '通用'}
                        </span>
                        
                        {site.wpAppPassword ? (
                          <span className="text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md flex items-center gap-1 font-medium">
                            <Key className="w-3 h-3" />
                            凭证就绪
                          </span>
                        ) : (
                          <span className="text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-md font-medium">
                            未配置密码
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end sm:justify-start">

                      <button
                        type="button"
                        onClick={() => handleStartEdit(site)}
                        className="flex-1 sm:flex-none px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5"
                        title="编辑站点配置"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-slate-600" />
                        <span>编辑</span>
                      </button>

                      {onDeleteSite && (
                        <button
                          type="button"
                          onClick={() => handleDelete(site.id)}
                          className="p-2.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition shrink-0"
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

      {editingSiteId && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200/80 rounded-2xl max-w-2xl w-full my-8 max-h-[92vh] flex flex-col shadow-xl animate-in zoom-in-95 duration-150">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/90 flex items-center justify-between sticky top-0 z-10 rounded-t-2xl">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-sm shadow-xs">
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
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-200/60 transition"
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
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">站点名称</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-900 text-xs font-semibold focus:outline-none focus:bg-white focus:border-slate-400"
                      placeholder="站点名称"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">绑定域名</label>
                    <input
                      type="text"
                      value={editForm.domain}
                      onChange={(e) => setEditForm({ ...editForm, domain: e.target.value })}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-800 text-xs font-mono focus:outline-none focus:bg-white focus:border-slate-400"
                      placeholder="域名"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-slate-500" />
                      <span>系统类型</span>
                    </label>
                    <div className="w-full px-3.5 py-2 bg-slate-100/80 border border-slate-200/80 rounded-xl text-slate-700 text-xs font-semibold flex items-center gap-1.5 select-none h-[34px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                      <span>WordPress</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                      <Languages className="w-3.5 h-3.5 text-slate-500" />
                      <span>站点语言</span>
                    </label>
                    <select
                      value={editForm.siteLanguage}
                      onChange={(e) => setEditForm({ ...editForm, siteLanguage: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-900 text-xs font-medium focus:outline-none focus:bg-white focus:border-slate-400"
                    >
                      <option value="zh-CN">🇨🇳 简体中文</option>
                      <option value="en-US">🇺🇸 英语 (美国)</option>
                      <option value="en">🌐 英语 (通用)</option>
                      <option value="ja">🇯🇵 日本语</option>
                      <option value="ko">🇰🇷 韩语</option>
                      <option value="de">🇩🇪 德语</option>
                      <option value="fr">🇫🇷 法语</option>
                      <option value="es">🇪🇸 西班牙语</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">所属行业</label>
                    <input
                      type="text"
                      value={editForm.niche}
                      onChange={(e) => setEditForm({ ...editForm, niche: e.target.value })}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-900 text-xs focus:outline-none focus:bg-white focus:border-slate-400"
                      placeholder="行业分类"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-1.5">
                    <Key className="w-4 h-4 text-blue-600" />
                    <span>2. 接口凭证</span>
                  </div>
                </div>

                {/* CMS Credentials in a super clean 2-column desktop layout */}
                <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-200/50 pb-1.5">
                    <span className="text-xs font-bold text-slate-800 flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-blue-600" />
                      <span>WordPress 凭证</span>
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-600 block">账号</label>
                      <input
                        type="text"
                        placeholder="用户名"
                        value={editForm.wpUsername}
                        onChange={(e) => setEditForm({ ...editForm, wpUsername: e.target.value })}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200/80 rounded-lg text-slate-900 text-xs focus:outline-none focus:border-slate-400"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-semibold text-slate-600">应用密码</label>
                      </div>
                      <input
                        type="password"
                        placeholder="密码"
                        value={editForm.wpAppPassword}
                        onChange={(e) => setEditForm({ ...editForm, wpAppPassword: e.target.value })}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200/80 rounded-lg text-slate-900 text-xs font-mono focus:outline-none focus:border-slate-400"
                      />
                    </div>
                  </div>
                </div>

                {/* Baidu Push Token */}
                <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                      <span className="text-xs font-bold text-slate-800">百度主动推送</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleTestSearchEngine('BAIDU')}
                      disabled={engineTesting !== null || !editForm.baiduToken}
                      className="px-2.5 py-1 bg-white hover:bg-blue-50 border border-slate-200/80 hover:border-blue-300 text-blue-700 text-[11px] rounded-lg transition font-medium flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                    >
                      {engineTesting === 'BAIDU' ? (
                        <RefreshCw className="w-3 h-3 animate-spin text-blue-600" />
                      ) : (
                        <Play className="w-3 h-3 fill-blue-600 text-blue-600" />
                      )}
                      <span>测试连接</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="请输入百度推送 Token"
                    value={editForm.baiduToken}
                    onChange={(e) => setEditForm({ ...editForm, baiduToken: e.target.value })}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200/80 rounded-lg text-slate-900 text-xs font-mono focus:outline-none focus:border-slate-400"
                  />
                  {renderCardTestResult('BAIDU')}
                </div>

                {/* Google Service Account */}
                <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-xs font-bold text-slate-800">Google Indexing API</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleTestSearchEngine('GOOGLE')}
                      disabled={engineTesting !== null || !editForm.googleServiceAccountJson}
                      className="px-2.5 py-1 bg-white hover:bg-red-50 border border-slate-200/80 hover:border-red-300 text-red-700 text-[11px] rounded-lg transition font-medium flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                    >
                      {engineTesting === 'GOOGLE' ? (
                        <RefreshCw className="w-3 h-3 animate-spin text-red-600" />
                      ) : (
                        <Play className="w-3 h-3 fill-red-600 text-red-600" />
                      )}
                      <span>测试连接</span>
                    </button>
                  </div>
                  <textarea
                    rows={3}
                    placeholder="请粘贴 Service Account JSON"
                    value={editForm.googleServiceAccountJson}
                    onChange={(e) => setEditForm({ ...editForm, googleServiceAccountJson: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200/80 rounded-lg text-slate-900 text-xs font-mono focus:outline-none focus:border-slate-400"
                  />
                  {renderCardTestResult('GOOGLE')}
                </div>
              </div>


            </div>

            <div className="p-4 px-6 border-t border-slate-100 bg-slate-50/80 flex items-center justify-end gap-3 sticky bottom-0 rounded-b-2xl">
              <button
                type="button"
                onClick={() => setEditingSiteId(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-200/80 bg-white text-slate-700 hover:bg-slate-100 text-xs font-medium transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => handleSaveEdit(editingSiteId)}
                className="px-6 py-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-xs font-bold transition flex items-center gap-1.5 shadow-sm active:scale-95"
              >
                <Check className="w-4 h-4 text-emerald-400" />
                <span>保存配置</span>
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
