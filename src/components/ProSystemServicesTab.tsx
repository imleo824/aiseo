import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  BrainCircuit, 
  Send, 
  Search, 
  Image, 
  BellRing, 
  Link2, 
  ShieldCheck, 
  Save, 
  RotateCcw, 
  CheckCircle2, 
  AlertTriangle, 
  Activity, 
  Terminal, 
  Eye, 
  EyeOff, 
  Check, 
  Cpu, 
  CloudLightning,
  ChevronRight,
  RefreshCw,
  Clock
} from 'lucide-react';
import { SystemServicesConfig, ServiceConnectionTestResult } from '../types/seo';
import { createApiService } from '../services/api';

interface ProSystemServicesTabProps {
  tenantId: string;
}

type SubTabType = 'AI' | 'SEARCH_INDEX' | 'SERP' | 'MEDIA' | 'WEBHOOK' | 'BLOCKCHAIN';

export const ProSystemServicesTab: React.FC<ProSystemServicesTabProps> = ({ tenantId }) => {
  const [activeTab, setActiveTab] = useState<SubTabType>('AI');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // System Services State
  const [config, setConfig] = useState<SystemServicesConfig | null>(null);

  // Secret Visibility States
  const [showGeminiKey, setShowGeminiKey] = useState<boolean>(false);
  const [showBaiduToken, setShowBaiduToken] = useState<boolean>(false);
  const [showBingKey, setShowBingKey] = useState<boolean>(false);
  const [showSerpKey, setShowSerpKey] = useState<boolean>(false);
  const [showUnsplashKey, setShowUnsplashKey] = useState<boolean>(false);
  const [showPexelsKey, setShowPexelsKey] = useState<boolean>(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState<boolean>(false);
  const [showTronGridKey, setShowTronGridKey] = useState<boolean>(false);

  // Test Connection States
  const [testingService, setTestingService] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ServiceConnectionTestResult | null>(null);

  useEffect(() => {
    fetchConfig();
  }, [tenantId]);

  const fetchConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const api = createApiService(tenantId);
      const res = await api.getSystemServicesConfig();
      if (res.success) {
        setConfig(res.config);
      } else {
        setError('加载系统配置失败，请确认当前管理员权限');
      }
    } catch (err: any) {
      setError(err?.message || '读取配置发生异常，网络请求未通过');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const api = createApiService(tenantId);
      const res = await api.updateSystemServicesConfig(config);
      if (res.success) {
        setConfig(res.config);
        setSuccessMsg('系统服务及 API 接口配置保存成功，全局实例已同步热更新');
        setTimeout(() => setSuccessMsg(null), 4000);
      } else {
        setError('保存失败，请检查参数合法性');
      }
    } catch (err: any) {
      setError(err?.message || '保存设置异常，请联系技术人员');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('确认要恢复系统默认的全部服务及 API 接口配置吗？该操作不可撤销！')) {
      return;
    }
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const api = createApiService(tenantId);
      const res = await api.resetSystemServicesConfig();
      if (res.success) {
        setConfig(res.config);
        setSuccessMsg('系统服务已成功恢复为默认出厂设置');
        setTimeout(() => setSuccessMsg(null), 4000);
      }
    } catch (err: any) {
      setError(err?.message || '恢复默认设置失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async (serviceType: string, customParams?: Record<string, any>) => {
    setTestingService(serviceType);
    setTestResult(null);
    try {
      const api = createApiService(tenantId);
      const res = await api.testServiceConnection(serviceType, customParams);
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        service: serviceType,
        success: false,
        latencyMs: 0,
        message: `测试异常: ${err?.message || '请求失败'}`,
        testedAt: new Date().toISOString()
      });
    } finally {
      setTestingService(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
        <p className="text-sm text-slate-500 font-medium">正在读取系统高可用服务及底层 API 配置协议...</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="p-6 bg-rose-50 rounded-xl border border-rose-200 text-rose-800 space-y-2">
        <div className="flex items-center gap-2 font-bold text-base">
          <AlertTriangle className="w-5 h-5 text-rose-600" />
          <span>无系统管理配置加载权限</span>
        </div>
        <p className="text-sm">仅平台超级管理员 (ADMIN) 可以查看与调整底层系统 API、大模型配置与区块链网关参数。</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-200">
      <div className="bg-slate-50 p-4.5 rounded-xl border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Settings className="w-4 h-4 text-slate-500" />
            第三方外部服务与核心 API 可视化看板
          </h3>
          <p className="text-[11px] text-slate-500 mt-1">
            作为平台超级管理员，您在此处配置的密钥、终结点、并发度与回调策略将实时注入到全站底层流水线、大模型代理与收录分发网关。
          </p>
        </div>
        <div className="flex gap-2.5 shrink-0 self-start md:self-center">
          <button
            onClick={handleReset}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 rounded-md font-medium transition cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            恢复默认
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-700 rounded-md font-medium transition shadow-xs cursor-pointer disabled:opacity-50"
          >
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            保存全部配置
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs flex items-start gap-2 animate-shake">
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="font-medium">{successMsg}</span>
        </div>
      )}

      {/* Sub tabs nav */}
      <div className="flex border-b border-slate-200 overflow-x-auto whitespace-nowrap scrollbar-none">
        <button
          onClick={() => { setActiveTab('AI'); setTestResult(null); }}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition flex items-center gap-2 ${
            activeTab === 'AI' 
              ? 'border-indigo-600 text-indigo-600' 
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <BrainCircuit className="w-4 h-4" />
          AI 智能撰写引擎
        </button>
        <button
          onClick={() => { setActiveTab('SEARCH_INDEX'); setTestResult(null); }}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition flex items-center gap-2 ${
            activeTab === 'SEARCH_INDEX' 
              ? 'border-indigo-600 text-indigo-600' 
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Send className="w-4 h-4" />
          站长推送与收录
        </button>
        <button
          onClick={() => { setActiveTab('SERP'); setTestResult(null); }}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition flex items-center gap-2 ${
            activeTab === 'SERP' 
              ? 'border-indigo-600 text-indigo-600' 
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Search className="w-4 h-4" />
          SERP 关键词数据源
        </button>
        <button
          onClick={() => { setActiveTab('MEDIA'); setTestResult(null); }}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition flex items-center gap-2 ${
            activeTab === 'MEDIA' 
              ? 'border-indigo-600 text-indigo-600' 
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Image className="w-4 h-4" />
          配图与多媒体网关
        </button>
        <button
          onClick={() => { setActiveTab('WEBHOOK'); setTestResult(null); }}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition flex items-center gap-2 ${
            activeTab === 'WEBHOOK' 
              ? 'border-indigo-600 text-indigo-600' 
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <BellRing className="w-4 h-4" />
          消息回调与告警
        </button>
        <button
          onClick={() => { setActiveTab('BLOCKCHAIN'); setTestResult(null); }}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition flex items-center gap-2 ${
            activeTab === 'BLOCKCHAIN' 
              ? 'border-indigo-600 text-indigo-600' 
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Link2 className="w-4 h-4" />
          TRC20 链上充值监听
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Side: Parameters Forms */}
        <div className="lg:col-span-2 space-y-5">
          
          {/* TAB 1: AI Engine */}
          {activeTab === 'AI' && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-2xs">
              <div className="border-b border-slate-100 pb-3">
                <h4 className="text-xs font-bold text-slate-950 uppercase tracking-wider flex items-center gap-1.5">
                  <Cpu className="w-4 h-4 text-indigo-600" />
                  大模型底座与生成策略
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">控制全流程写作深度、多机备份以及自定义代理端点</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700">基础 AI 服务商</label>
                  <select
                    value={config.aiEngine.provider}
                    onChange={(e) => setConfig({
                      ...config,
                      aiEngine: { ...config.aiEngine, provider: e.target.value as any }
                    })}
                    className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md bg-white focus:border-indigo-500"
                  >
                    <option value="GEMINI">Google Gemini API (推荐，系统默认原生极速)</option>
                    <option value="OPENAI_COMPATIBLE">OpenAI 兼容端点 (第三方中转/自建 API)</option>
                    <option value="AZURE_OPENAI">Azure OpenAI 企业级端点</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700">生成目标主模型</label>
                  <input
                    type="text"
                    value={config.aiEngine.geminiModel}
                    onChange={(e) => setConfig({
                      ...config,
                      aiEngine: { ...config.aiEngine, geminiModel: e.target.value }
                    })}
                    className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md focus:border-indigo-500"
                    placeholder="e.g. gemini-2.5-flash"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700">容灾备份模型</label>
                  <input
                    type="text"
                    value={config.aiEngine.fallbackModel || ''}
                    onChange={(e) => setConfig({
                      ...config,
                      aiEngine: { ...config.aiEngine, fallbackModel: e.target.value }
                    })}
                    className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md focus:border-indigo-500"
                    placeholder="e.g. gemini-1.5-flash"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700">生成创造力 (Temperature: {config.aiEngine.temperature})</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0"
                      max="1.5"
                      step="0.1"
                      value={config.aiEngine.temperature}
                      onChange={(e) => setConfig({
                        ...config,
                        aiEngine: { ...config.aiEngine, temperature: parseFloat(e.target.value) }
                      })}
                      className="w-full accent-indigo-600"
                    />
                    <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                      {config.aiEngine.temperature}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700">最大生成字数 Token</label>
                  <input
                    type="number"
                    value={config.aiEngine.maxOutputTokens}
                    onChange={(e) => setConfig({
                      ...config,
                      aiEngine: { ...config.aiEngine, maxOutputTokens: parseInt(e.target.value) || 2048 }
                    })}
                    className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700">接口级最大并发上限</label>
                  <input
                    type="number"
                    value={config.aiEngine.maxConcurrency}
                    onChange={(e) => setConfig({
                      ...config,
                      aiEngine: { ...config.aiEngine, maxConcurrency: parseInt(e.target.value) || 5 }
                    })}
                    className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md focus:border-indigo-500 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-700">API 网关中转端点 Endpoint (可选)</label>
                <input
                  type="text"
                  value={config.aiEngine.customEndpoint || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    aiEngine: { ...config.aiEngine, customEndpoint: e.target.value }
                  })}
                  className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md focus:border-indigo-500 font-mono"
                  placeholder="留空则直连官方API，如需中转可填 https://api.openai.com/v1 等"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-700 flex justify-between">
                  <span>自定义 API 授权令牌 Key (优先级高于系统环境变量)</span>
                  <button 
                    type="button" 
                    onClick={() => setShowGeminiKey(!showGeminiKey)} 
                    className="text-indigo-600 hover:underline flex items-center gap-1 font-normal"
                  >
                    {showGeminiKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    {showGeminiKey ? '隐藏' : '显示'}
                  </button>
                </label>
                <input
                  type={showGeminiKey ? "text" : "password"}
                  value={config.aiEngine.customApiKey || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    aiEngine: { ...config.aiEngine, customApiKey: e.target.value }
                  })}
                  className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md focus:border-indigo-500 font-mono"
                  placeholder="若未指定将默认读取全平台公用 GEMINI_API_KEY"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-700">SEO 全剧角色扮演预设引导 System Prompt Prefix</label>
                <textarea
                  rows={3}
                  value={config.aiEngine.systemPromptPrefix || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    aiEngine: { ...config.aiEngine, systemPromptPrefix: e.target.value }
                  })}
                  className="w-full text-xs p-3 border border-slate-200 rounded-md focus:border-indigo-500"
                  placeholder="用于大模型开始规划结构长文时的核心角色声明"
                />
              </div>
            </div>
          )}

          {/* TAB 2: Search Engines */}
          {activeTab === 'SEARCH_INDEX' && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5 shadow-2xs">
              <div className="border-b border-slate-100 pb-3">
                <h4 className="text-xs font-bold text-slate-950 uppercase tracking-wider flex items-center gap-1.5">
                  <Send className="w-4 h-4 text-indigo-600" />
                  各大搜索引擎推送与极速收录协议
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">控制当租户发文或巡航完成时，搜索引擎的主动抓取推送策略</p>
              </div>

              {/* Baidu Push */}
              <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 space-y-3">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    百度站长主动推送 (实时专线)
                  </h5>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={config.searchEngine.baiduPush.enabled} 
                      onChange={(e) => setConfig({
                        ...config,
                        searchEngine: {
                          ...config.searchEngine,
                          baiduPush: { ...config.searchEngine.baiduPush, enabled: e.target.checked }
                        }
                      })}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>
                
                {config.searchEngine.baiduPush.enabled && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                    <div className="space-y-1.5">
                      <label className="text-[11px] text-slate-600">百度备案绑定主域名</label>
                      <input
                        type="text"
                        value={config.searchEngine.baiduPush.siteDomain}
                        onChange={(e) => setConfig({
                          ...config,
                          searchEngine: {
                            ...config.searchEngine,
                            baiduPush: { ...config.searchEngine.baiduPush, siteDomain: e.target.value }
                          }
                        })}
                        className="w-full text-xs px-2.5 py-1.2 border border-slate-200 rounded-md"
                        placeholder="e.g. https://www.yourdomain.com"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label className="text-[11px] text-slate-600">接口调用 Token</label>
                        <button 
                          type="button" 
                          onClick={() => setShowBaiduToken(!showBaiduToken)} 
                          className="text-[10px] text-indigo-600 hover:underline"
                        >
                          {showBaiduToken ? '隐藏' : '显示'}
                        </button>
                      </div>
                      <input
                        type={showBaiduToken ? "text" : "password"}
                        value={config.searchEngine.baiduPush.token}
                        onChange={(e) => setConfig({
                          ...config,
                          searchEngine: {
                            ...config.searchEngine,
                            baiduPush: { ...config.searchEngine.baiduPush, token: e.target.value }
                          }
                        })}
                        className="w-full text-xs px-2.5 py-1.2 border border-slate-200 rounded-md font-mono"
                        placeholder="百度站长后台获取的 16位 准入密钥"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Bing IndexNow */}
              <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 space-y-3">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-indigo-500" />
                    Bing / Yandex IndexNow 收录联盟
                  </h5>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={config.searchEngine.bingIndexNow.enabled} 
                      onChange={(e) => setConfig({
                        ...config,
                        searchEngine: {
                          ...config.searchEngine,
                          bingIndexNow: { ...config.searchEngine.bingIndexNow, enabled: e.target.checked }
                        }
                      })}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                {config.searchEngine.bingIndexNow.enabled && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label className="text-[11px] text-slate-600">验证密钥 Key (32位十六进制)</label>
                        <button 
                          type="button" 
                          onClick={() => setShowBingKey(!showBingKey)} 
                          className="text-[10px] text-indigo-600 hover:underline"
                        >
                          {showBingKey ? '隐藏' : '显示'}
                        </button>
                      </div>
                      <input
                        type={showBingKey ? "text" : "password"}
                        value={config.searchEngine.bingIndexNow.apiKey}
                        onChange={(e) => setConfig({
                          ...config,
                          searchEngine: {
                            ...config.searchEngine,
                            bingIndexNow: { ...config.searchEngine.bingIndexNow, apiKey: e.target.value }
                          }
                        })}
                        className="w-full text-xs px-2.5 py-1.2 border border-slate-200 rounded-md font-mono"
                        placeholder="用于 Bing 对提交方域名的身份信任检验"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] text-slate-600">Key 的网络校验地址 URL (Key Location)</label>
                      <input
                        type="text"
                        value={config.searchEngine.bingIndexNow.keyLocation || ''}
                        onChange={(e) => setConfig({
                          ...config,
                          searchEngine: {
                            ...config.searchEngine,
                            bingIndexNow: { ...config.searchEngine.bingIndexNow, keyLocation: e.target.value }
                          }
                        })}
                        className="w-full text-xs px-2.5 py-1.2 border border-slate-200 rounded-md font-mono"
                        placeholder="e.g. https://domain.com/key.txt"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Google Indexing API */}
              <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 space-y-3">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    Google Indexing 极速爬网 API
                  </h5>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={config.searchEngine.googleIndexing.enabled} 
                      onChange={(e) => setConfig({
                        ...config,
                        searchEngine: {
                          ...config.searchEngine,
                          googleIndexing: { ...config.searchEngine.googleIndexing, enabled: e.target.checked }
                        }
                      })}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                {config.searchEngine.googleIndexing.enabled && (
                  <div className="space-y-1.5 pt-1">
                    <label className="text-[11px] text-slate-600 flex justify-between">
                      <span>Google API 凭据 Service Account JSON</span>
                      <span className="text-[10px] text-slate-400">需包含 private_key 和 client_email 声明</span>
                    </label>
                    <textarea
                      rows={3}
                      value={config.searchEngine.googleIndexing.serviceAccountJson || ''}
                      onChange={(e) => setConfig({
                        ...config,
                        searchEngine: {
                          ...config.searchEngine,
                          googleIndexing: { ...config.searchEngine.googleIndexing, serviceAccountJson: e.target.value }
                        }
                      })}
                      className="w-full text-xs p-2.5 border border-slate-200 rounded-md font-mono"
                      placeholder='{ "type": "service_account", "project_id": "seo-autopilot", ... }'
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: SERP Keywords */}
          {activeTab === 'SERP' && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-2xs">
              <div className="border-b border-slate-100 pb-3">
                <h4 className="text-xs font-bold text-slate-950 uppercase tracking-wider flex items-center gap-1.5">
                  <Search className="w-4 h-4 text-indigo-600" />
                  SERP 实时流量密码解析引擎
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">控制进行智能拓词与竞品漏洞盲区逆向分析的数据源配置</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700">搜索引擎爬取数据源</label>
                  <select
                    value={config.serpData.provider}
                    onChange={(e) => setConfig({
                      ...config,
                      serpData: { ...config.serpData, provider: e.target.value as any }
                    })}
                    className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md bg-white focus:border-indigo-500"
                  >
                    <option value="HYBRID_ENGINE">SEO Autopilot 智能混合探针 (原生推荐)</option>
                    <option value="DATAFORSEO">DataForSEO API 网关专线</option>
                    <option value="SERPAPI">SerpAPI 爬网中转端</option>
                    <option value="GOOGLE_CSE">Google 自定义搜索 API</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700">解析数据缓存寿命 (TTL 小时)</label>
                  <input
                    type="number"
                    value={config.serpData.cacheTtlHours}
                    onChange={(e) => setConfig({
                      ...config,
                      serpData: { ...config.serpData, cacheTtlHours: parseInt(e.target.value) || 24 }
                    })}
                    className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700">默认解析地理区域 (Country)</label>
                  <input
                    type="text"
                    value={config.serpData.defaultLocation}
                    onChange={(e) => setConfig({
                      ...config,
                      serpData: { ...config.serpData, defaultLocation: e.target.value }
                    })}
                    className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md focus:border-indigo-500"
                    placeholder="e.g. US, CN, HK"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700">默认解析关联语言 (Language)</label>
                  <input
                    type="text"
                    value={config.serpData.defaultLanguage}
                    onChange={(e) => setConfig({
                      ...config,
                      serpData: { ...config.serpData, defaultLanguage: e.target.value }
                    })}
                    className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md focus:border-indigo-500"
                    placeholder="e.g. en, zh"
                  />
                </div>
              </div>

              {config.serpData.provider === 'DATAFORSEO' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-indigo-50/50 border border-indigo-100 rounded-lg">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-indigo-900">DataForSEO 登录账户</label>
                    <input
                      type="text"
                      value={config.serpData.dataForSeoLogin || ''}
                      onChange={(e) => setConfig({
                        ...config,
                        serpData: { ...config.serpData, dataForSeoLogin: e.target.value }
                      })}
                      className="w-full text-xs px-2 py-1 border border-indigo-200 rounded bg-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-indigo-900">DataForSEO API 密码 / 密钥</label>
                    <input
                      type="password"
                      value={config.serpData.dataForSeoPassword || ''}
                      onChange={(e) => setConfig({
                        ...config,
                        serpData: { ...config.serpData, dataForSeoPassword: e.target.value }
                      })}
                      className="w-full text-xs px-2 py-1 border border-indigo-200 rounded bg-white"
                    />
                  </div>
                </div>
              )}

              {config.serpData.provider === 'SERPAPI' && (
                <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-lg space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold text-indigo-900">SerpAPI Key 授权凭据</label>
                    <button 
                      type="button" 
                      onClick={() => setShowSerpKey(!showSerpKey)} 
                      className="text-[10px] text-indigo-600 hover:underline"
                    >
                      {showSerpKey ? '隐藏' : '显示'}
                    </button>
                  </div>
                  <input
                    type={showSerpKey ? "text" : "password"}
                    value={config.serpData.serpApiKey || ''}
                    onChange={(e) => setConfig({
                      ...config,
                      serpData: { ...config.serpData, serpApiKey: e.target.value }
                    })}
                    className="w-full text-xs px-2.5 py-1 border border-indigo-200 rounded bg-white font-mono"
                    placeholder="e.g. api_key_abcd1234..."
                  />
                </div>
              )}
            </div>
          )}

          {/* TAB 4: Media Services */}
          {activeTab === 'MEDIA' && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-2xs">
              <div className="border-b border-slate-100 pb-3">
                <h4 className="text-xs font-bold text-slate-950 uppercase tracking-wider flex items-center gap-1.5">
                  <Image className="w-4 h-4 text-indigo-600" />
                  原创插图与多媒体自动化引擎
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">控制在生成高质量长文时的排版配图来源与网络压缩选项</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700">图片服务引擎</label>
                  <select
                    value={config.mediaService.imageProvider}
                    onChange={(e) => setConfig({
                      ...config,
                      mediaService: { ...config.mediaService, imageProvider: e.target.value as any }
                    })}
                    className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md bg-white focus:border-indigo-500"
                  >
                    <option value="GEMINI_IMAGEN">Gemini Imagen 3 原创绘画 (AI 实时创作)</option>
                    <option value="UNSPLASH">Unsplash 官方免版权图库</option>
                    <option value="PEXELS">Pexels 极速图库网关</option>
                    <option value="LOCAL_PLACEHOLDER">本站轻量占位占位符 (极速开发)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700">智能裁剪与排版构图</label>
                  <select
                    value={config.mediaService.imageOrientation}
                    onChange={(e) => setConfig({
                      ...config,
                      mediaService: { ...config.mediaService, imageOrientation: e.target.value as any }
                    })}
                    className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md bg-white focus:border-indigo-500"
                  >
                    <option value="landscape">宽幅横屏构图 (16:9 Landscape - 推荐博文首图)</option>
                    <option value="squarish">方形构图 (1:1 Square - 适合配图展示)</option>
                    <option value="portrait">竖版人像构图 (3:4 Portrait)</option>
                  </select>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h5 className="text-[11px] font-bold text-slate-900">自动注入 ALT 替代文本与图注</h5>
                    <p className="text-[10px] text-slate-400">大模型根据配图智能合成，提升搜索引擎图片 SEO 收录率</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={config.mediaService.autoInsertAlt} 
                      onChange={(e) => setConfig({
                        ...config,
                        mediaService: { ...config.mediaService, autoInsertAlt: e.target.checked }
                      })}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between border-t border-slate-150 pt-2.5">
                  <div>
                    <h5 className="text-[11px] font-bold text-slate-900">WebP 超高比例物理压缩</h5>
                    <p className="text-[10px] text-slate-400">自动优化图片加载体积至原图的 30% 以下，显著降低页面 LCP 指标</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={config.mediaService.compressWebp} 
                      onChange={(e) => setConfig({
                        ...config,
                        mediaService: { ...config.mediaService, compressWebp: e.target.checked }
                      })}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>
              </div>

              {config.mediaService.imageProvider === 'UNSPLASH' && (
                <div className="space-y-1.5 p-3 bg-indigo-50/50 border border-indigo-100 rounded-lg">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold text-indigo-900">Unsplash Developer Access Key</label>
                    <button 
                      type="button" 
                      onClick={() => setShowUnsplashKey(!showUnsplashKey)} 
                      className="text-[10px] text-indigo-600 hover:underline"
                    >
                      {showUnsplashKey ? '隐藏' : '显示'}
                    </button>
                  </div>
                  <input
                    type={showUnsplashKey ? "text" : "password"}
                    value={config.mediaService.unsplashAccessKey || ''}
                    onChange={(e) => setConfig({
                      ...config,
                      mediaService: { ...config.mediaService, unsplashAccessKey: e.target.value }
                    })}
                    className="w-full text-xs px-2 py-1 bg-white border border-indigo-200 rounded font-mono"
                  />
                </div>
              )}
            </div>
          )}

          {/* TAB 5: Webhooks */}
          {activeTab === 'WEBHOOK' && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-2xs">
              <div className="border-b border-slate-100 pb-3">
                <h4 className="text-xs font-bold text-slate-950 uppercase tracking-wider flex items-center gap-1.5">
                  <BellRing className="w-4 h-4 text-indigo-600" />
                  系统级异常告警与事件 Webhook 回调
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">连接企业通讯软件，实时捕获熔断拦截、积分透支及发文完成状态</p>
              </div>

              <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-150">
                <div>
                  <h5 className="text-xs font-bold text-slate-900">全局启用消息回调推送</h5>
                  <p className="text-[10px] text-slate-500 mt-0.5">当选中事件触发时，系统将使用标准的 JSON 格式推送至目标网络通道</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={config.webhookNotification.enabled} 
                    onChange={(e) => setConfig({
                      ...config,
                      webhookNotification: { ...config.webhookNotification, enabled: e.target.checked }
                    })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>

              {config.webhookNotification.enabled && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-700">通讯软件类型 (适配各平台卡片格式)</label>
                      <select
                        value={config.webhookNotification.webhookType}
                        onChange={(e) => setConfig({
                          ...config,
                          webhookNotification: { ...config.webhookNotification, webhookType: e.target.value as any }
                        })}
                        className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md bg-white focus:border-indigo-500"
                      >
                        <option value="FEISHU">飞书企业机器人 (智能富文本卡片)</option>
                        <option value="DINGTALK">钉钉群机器人 (Markdown 渲染)</option>
                        <option value="WECHAT_WORK">企业微信机器人 (标准 Markdown)</option>
                        <option value="SLACK">Slack Incoming Webhook</option>
                        <option value="DISCORD">Discord Webhook</option>
                        <option value="CUSTOM">标准自定义 JSON 原始推送</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-700">租户低积分告警水位线 (Credits)</label>
                      <input
                        type="number"
                        value={config.webhookNotification.lowCreditThreshold}
                        onChange={(e) => setConfig({
                          ...config,
                          webhookNotification: { ...config.webhookNotification, lowCreditThreshold: parseInt(e.target.value) || 100 }
                        })}
                        className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md focus:border-indigo-500 font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-700">回调 Webhook Endpoint URL</label>
                    <input
                      type="text"
                      value={config.webhookNotification.webhookUrl}
                      onChange={(e) => setConfig({
                        ...config,
                        webhookNotification: { ...config.webhookNotification, webhookUrl: e.target.value }
                      })}
                      className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md focus:border-indigo-500 font-mono"
                      placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-[11px] font-bold text-slate-700">安全密钥 Secret Token (可选 - 飞书/钉钉验证签名)</label>
                      <button 
                        type="button" 
                        onClick={() => setShowWebhookSecret(!showWebhookSecret)} 
                        className="text-[10px] text-indigo-600 hover:underline font-normal"
                      >
                        {showWebhookSecret ? '隐藏' : '显示'}
                      </button>
                    </div>
                    <input
                      type={showWebhookSecret ? "text" : "password"}
                      value={config.webhookNotification.secretKey || ''}
                      onChange={(e) => setConfig({
                        ...config,
                        webhookNotification: { ...config.webhookNotification, secretKey: e.target.value }
                      })}
                      className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md focus:border-indigo-500 font-mono"
                      placeholder="用于服务端签名校验，保障推送路径防篡改"
                    />
                  </div>

                  {/* Trigger Events Checkboxes */}
                  <div className="space-y-2 pt-1">
                    <label className="text-[11px] font-bold text-slate-700 block">选定要推送的事件类型 (Event Filters)</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-100 hover:bg-slate-100/50 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={config.webhookNotification.events.onPublishSuccess}
                          onChange={(e) => setConfig({
                            ...config,
                            webhookNotification: {
                              ...config.webhookNotification,
                              events: { ...config.webhookNotification.events, onPublishSuccess: e.target.checked }
                            }
                          })}
                          className="accent-indigo-600"
                        />
                        <div>
                          <p className="font-semibold text-slate-800">一键发文/定时巡航成功</p>
                          <p className="text-[9px] text-slate-400">页面文章同步、Baidu/Google 收录推送均成功时</p>
                        </div>
                      </label>

                      <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-100 hover:bg-slate-100/50 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={config.webhookNotification.events.onTaskFailure}
                          onChange={(e) => setConfig({
                            ...config,
                            webhookNotification: {
                              ...config.webhookNotification,
                              events: { ...config.webhookNotification.events, onTaskFailure: e.target.checked }
                            }
                          })}
                          className="accent-indigo-600"
                        />
                        <div>
                          <p className="font-semibold text-slate-800">巡航执行异常/门禁拦截</p>
                          <p className="text-[9px] text-slate-400">大模型生成超时、质量评估未过关、接口熔断时</p>
                        </div>
                      </label>

                      <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-100 hover:bg-slate-100/50 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={config.webhookNotification.events.onLowCreditAlert}
                          onChange={(e) => setConfig({
                            ...config,
                            webhookNotification: {
                              ...config.webhookNotification,
                              events: { ...config.webhookNotification.events, onLowCreditAlert: e.target.checked }
                            }
                          })}
                          className="accent-indigo-600"
                        />
                        <div>
                          <p className="font-semibold text-slate-800">租户基础算力池告警</p>
                          <p className="text-[9px] text-slate-400">租户发文时积分低于水位线，友情提醒充值</p>
                        </div>
                      </label>

                      <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-100 hover:bg-slate-100/50 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={config.webhookNotification.events.onNewTopupPending}
                          onChange={(e) => setConfig({
                            ...config,
                            webhookNotification: {
                              ...config.webhookNotification,
                              events: { ...config.webhookNotification.events, onNewTopupPending: e.target.checked }
                            }
                          })}
                          className="accent-indigo-600"
                        />
                        <div>
                          <p className="font-semibold text-slate-800">链上新到账交易提醒</p>
                          <p className="text-[9px] text-slate-400">租户触发波场 TRC20 链上充值并且检测到网络到账时</p>
                        </div>
                      </label>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 6: Blockchain Gateways */}
          {activeTab === 'BLOCKCHAIN' && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-2xs">
              <div className="border-b border-slate-100 pb-3">
                <h4 className="text-xs font-bold text-slate-950 uppercase tracking-wider flex items-center gap-1.5">
                  <Link2 className="w-4 h-4 text-indigo-600" />
                  波场 TRC20 去中心化收单链上监听网关
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">管理分布式 RPC 轮询监听节点和资金安全链上签名确认参数</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700">监听目标主网</label>
                  <select
                    value={config.blockchainGateway.network}
                    onChange={(e) => setConfig({
                      ...config,
                      blockchainGateway: { ...config.blockchainGateway, network: e.target.value as any }
                    })}
                    className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md bg-white focus:border-indigo-500 font-bold"
                  >
                    <option value="TRC20">TRON Mainnet (TRC-20 USDT/TRX)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700">充值安全到账确认数 (Confirmations)</label>
                  <input
                    type="number"
                    value={config.blockchainGateway.requiredConfirmations}
                    onChange={(e) => setConfig({
                      ...config,
                      blockchainGateway: { ...config.blockchainGateway, requiredConfirmations: parseInt(e.target.value) || 19 }
                    })}
                    className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700">高频轮询检索频率 (Seconds)</label>
                  <input
                    type="number"
                    value={config.blockchainGateway.autoScanIntervalSeconds}
                    onChange={(e) => setConfig({
                      ...config,
                      blockchainGateway: { ...config.blockchainGateway, autoScanIntervalSeconds: parseInt(e.target.value) || 30 }
                    })}
                    className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700">波场极速 Rpc 节点</label>
                  <input
                    type="text"
                    value={config.blockchainGateway.customRpcUrl || ''}
                    onChange={(e) => setConfig({
                      ...config,
                      blockchainGateway: { ...config.blockchainGateway, customRpcUrl: e.target.value }
                    })}
                    className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md focus:border-indigo-500 font-mono"
                    placeholder="e.g. https://api.trongrid.io"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[11px] font-bold text-slate-700">TronGrid API 专用开发密钥</label>
                  <button 
                    type="button" 
                    onClick={() => setShowTronGridKey(!showTronGridKey)} 
                    className="text-[10px] text-indigo-600 hover:underline font-normal"
                  >
                    {showTronGridKey ? '隐藏' : '显示'}
                  </button>
                </div>
                <input
                  type={showTronGridKey ? "text" : "password"}
                  value={config.blockchainGateway.tronGridApiKey || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    blockchainGateway: { ...config.blockchainGateway, tronGridApiKey: e.target.value }
                  })}
                  className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-md focus:border-indigo-500 font-mono"
                  placeholder="留空则走非高频通道公共请求限制"
                />
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Network Diagnosis Suite */}
        <div className="space-y-5">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-white space-y-4 shadow-xs relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />
            
            <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  接口连通性秒级诊断套件
                </h4>
                <p className="text-[10px] text-slate-400 mt-0.5">秒级发起外部集成探测，校验端对端网络连通性</p>
              </div>
              <span className="text-[9px] bg-slate-800 border border-slate-700 px-2 py-0.5 rounded font-mono font-semibold text-slate-300">
                ADMIN UTILS
              </span>
            </div>

            <div className="space-y-2.5">
              <button
                onClick={() => handleTestConnection('GEMINI_AI', { apiKey: config.aiEngine.customApiKey, model: config.aiEngine.geminiModel })}
                disabled={testingService !== null}
                className="w-full flex items-center justify-between p-2.5 bg-slate-800/60 border border-slate-800 hover:border-slate-700 hover:bg-slate-800 text-xs rounded-lg transition text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <BrainCircuit className="w-4 h-4 text-purple-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-200">Gemini 智能撰写</p>
                    <p className="text-[9px] text-slate-400">探测主力生成模型响应</p>
                  </div>
                </div>
                {testingService === 'GEMINI_AI' ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                )}
              </button>

              <button
                onClick={() => handleTestConnection('BAIDU_PUSH', { siteDomain: config.searchEngine.baiduPush.siteDomain, token: config.searchEngine.baiduPush.token })}
                disabled={testingService !== null}
                className="w-full flex items-center justify-between p-2.5 bg-slate-800/60 border border-slate-800 hover:border-slate-700 hover:bg-slate-800 text-xs rounded-lg transition text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Send className="w-4 h-4 text-blue-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-200">百度主动推送 API</p>
                    <p className="text-[9px] text-slate-400">校验百度实时推送通道</p>
                  </div>
                </div>
                {testingService === 'BAIDU_PUSH' ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                )}
              </button>

              <button
                onClick={() => handleTestConnection('BING_INDEXNOW', { apiKey: config.searchEngine.bingIndexNow.apiKey })}
                disabled={testingService !== null}
                className="w-full flex items-center justify-between p-2.5 bg-slate-800/60 border border-slate-800 hover:border-slate-700 hover:bg-slate-800 text-xs rounded-lg transition text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <CloudLightning className="w-4 h-4 text-sky-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-200">Bing IndexNow 推送</p>
                    <p className="text-[9px] text-slate-400">探测微软联盟网关</p>
                  </div>
                </div>
                {testingService === 'BING_INDEXNOW' ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                )}
              </button>

              <button
                onClick={() => handleTestConnection('WEBHOOK_NOTIFICATION', { webhookUrl: config.webhookNotification.webhookUrl, webhookType: config.webhookNotification.webhookType })}
                disabled={testingService !== null}
                className="w-full flex items-center justify-between p-2.5 bg-slate-800/60 border border-slate-800 hover:border-slate-700 hover:bg-slate-800 text-xs rounded-lg transition text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <BellRing className="w-4 h-4 text-amber-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-200">Webhook 告警回调</p>
                    <p className="text-[9px] text-slate-400">推送飞书/群消息测试通知</p>
                  </div>
                </div>
                {testingService === 'WEBHOOK_NOTIFICATION' ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                )}
              </button>

              <button
                onClick={() => handleTestConnection('TRON_GATEWAY', { customRpcUrl: config.blockchainGateway.customRpcUrl })}
                disabled={testingService !== null}
                className="w-full flex items-center justify-between p-2.5 bg-slate-800/60 border border-slate-800 hover:border-slate-700 hover:bg-slate-800 text-xs rounded-lg transition text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-200">TRC20 区块链节点</p>
                    <p className="text-[9px] text-slate-400">获取波场主网最新区块高度</p>
                  </div>
                </div>
                {testingService === 'TRON_GATEWAY' ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                )}
              </button>
            </div>

            {/* Diagnostics Output Terminal */}
            <div className="border-t border-slate-850 pt-4 mt-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                  <Terminal className="w-3 h-3 text-indigo-400" />
                  诊断输出终端 (Diagnostics Panel)
                </span>
                {testResult && (
                  <span className={`text-[9px] font-bold font-mono px-1.5 py-0.5 rounded ${
                    testResult.success ? 'text-emerald-400 bg-emerald-950/50' : 'text-rose-400 bg-rose-950/50'
                  }`}>
                    {testResult.success ? 'PASS' : 'FAILED'}
                  </span>
                )}
              </div>

              <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-850 font-mono text-[10px] leading-relaxed min-h-[120px] max-h-[220px] overflow-y-auto text-slate-300">
                {testResult ? (
                  <div className="space-y-2">
                    <div className="flex justify-between text-slate-400">
                      <span>检测目标: {testResult.service}</span>
                      <span className="flex items-center gap-0.5">
                        <Clock className="w-3 h-3" />
                        {testResult.latencyMs}ms
                      </span>
                    </div>
                    <div className={`p-1.5 rounded ${testResult.success ? 'text-emerald-400 bg-emerald-950/30' : 'text-rose-400 bg-rose-950/30'}`}>
                      {testResult.success ? '✓ 成功连通' : '✗ 发生错误'}: {testResult.message}
                    </div>
                    {testResult.details && (
                      <div className="space-y-1 text-slate-400 text-[9px] border-t border-slate-900 pt-1.5">
                        <p className="text-[10px] font-bold text-slate-300">探测返回包特征值:</p>
                        <pre className="overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(testResult.details, null, 2)}
                        </pre>
                      </div>
                    )}
                    <p className="text-[9px] text-slate-500 text-right">时间戳: {new Date(testResult.testedAt).toLocaleTimeString()}</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-slate-500 space-y-1.5">
                    <Activity className="w-6 h-6 animate-pulse text-slate-600" />
                    <p>等待选择一个服务发起一键连通性测试</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
