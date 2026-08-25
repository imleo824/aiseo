import React, { useState, useEffect } from 'react';
import { 
  BrainCircuit, 
  Search, 
  Image, 
  Link2, 
  Save, 
  CheckCircle2, 
  AlertTriangle, 
  Activity, 
  Terminal, 
  Eye, 
  EyeOff, 
  RefreshCw,
  Clock,
  Play
} from 'lucide-react';
import { SystemServicesConfig, ServiceConnectionTestResult } from '../types/seo';
import { createApiService } from '../services/api';

interface ProSystemServicesTabProps {
  tenantId: string;
}

type SubTabType = 'AI' | 'SERP' | 'MEDIA' | 'BLOCKCHAIN';

export const ProSystemServicesTab: React.FC<ProSystemServicesTabProps> = ({ tenantId }) => {
  const [activeTab, setActiveTab] = useState<SubTabType>('AI');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [config, setConfig] = useState<SystemServicesConfig | null>(null);

  // Secret Visibility
  const [showGeminiKey, setShowGeminiKey] = useState<boolean>(false);
  const [showSerpKey, setShowSerpKey] = useState<boolean>(false);
  const [showUnsplashKey, setShowUnsplashKey] = useState<boolean>(false);
  const [showPexelsKey, setShowPexelsKey] = useState<boolean>(false);
  const [showTronGridKey, setShowTronGridKey] = useState<boolean>(false);

  // Test Connection
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
        setError('加载服务配置失败，请确认管理员权限');
      }
    } catch (err: any) {
      setError(err?.message || '读取配置失败');
    } finally {
      setLoading(false);
    }
  };

  const validateClientFields = (cfg: SystemServicesConfig): { isValid: boolean; errors: Record<string, string> } => {
    const errors: Record<string, string> = {};

    // AI
    if (!cfg.aiEngine.geminiModel || cfg.aiEngine.geminiModel.trim().length === 0) {
      errors['aiEngine.geminiModel'] = 'AI 模型标识不能为空';
    }
    if (cfg.aiEngine.temperature < 0 || cfg.aiEngine.temperature > 2.0) {
      errors['aiEngine.temperature'] = '温度必须在 0.0 到 2.0 之间';
    }
    if (cfg.aiEngine.maxOutputTokens < 256 || cfg.aiEngine.maxOutputTokens > 32768) {
      errors['aiEngine.maxOutputTokens'] = '最大 Token 应在 256 到 32768 之间';
    }
    if (cfg.aiEngine.maxConcurrency < 1 || cfg.aiEngine.maxConcurrency > 50) {
      errors['aiEngine.maxConcurrency'] = '并发数应在 1 到 50 之间';
    }
    if (cfg.aiEngine.customEndpoint && cfg.aiEngine.customEndpoint.trim().length > 0) {
      if (!/^https?:\/\//i.test(cfg.aiEngine.customEndpoint.trim())) {
        errors['aiEngine.customEndpoint'] = '自定义端点必须以 http:// 或 https:// 开头';
      }
    }

    // Blockchain
    if (cfg.blockchainGateway.requiredConfirmations < 1 || cfg.blockchainGateway.requiredConfirmations > 100) {
      errors['blockchainGateway.requiredConfirmations'] = '确认数应在 1 到 100 之间 (推荐 19)';
    }
    if (cfg.blockchainGateway.autoScanIntervalSeconds < 5 || cfg.blockchainGateway.autoScanIntervalSeconds > 600) {
      errors['blockchainGateway.autoScanIntervalSeconds'] = '轮询秒数应在 5 到 600 秒之间';
    }
    if (cfg.blockchainGateway.customRpcUrl && cfg.blockchainGateway.customRpcUrl.trim().length > 0) {
      if (!/^https?:\/\//i.test(cfg.blockchainGateway.customRpcUrl.trim())) {
        errors['blockchainGateway.customRpcUrl'] = 'RPC 节点地址必须以 http:// 或 https:// 开头';
      }
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  };

  const handleSave = async () => {
    if (!config) return;
    setError(null);
    setSuccessMsg(null);

    const clientValidation = validateClientFields(config);
    setFieldErrors(clientValidation.errors);
    if (!clientValidation.isValid) {
      setError('配置存在不合规字段，请根据红字提示修正后保存');
      return;
    }

    setSaving(true);
    try {
      const api = createApiService(tenantId);
      const res = await api.updateSystemServicesConfig(config);
      if (res.success) {
        setConfig(res.config);
        setFieldErrors({});
        setSuccessMsg('服务配置已通过标准校验并成功保存生效');
        setTimeout(() => setSuccessMsg(null), 3000);
      } else {
        setError(res.message || '保存失败，请检查填写内容');
      }
    } catch (err: any) {
      setError(err?.message || '保存配置异常');
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
      <div className="flex flex-col items-center justify-center py-20 space-y-3">
        <RefreshCw className="w-6 h-6 text-indigo-600 animate-spin" />
        <p className="text-xs text-slate-500">正在加载服务配置...</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="p-4 bg-rose-50 rounded-lg border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
        <span>仅系统管理员有权查看和修改服务集成配置。</span>
      </div>
    );
  }

  return (
    <div className="w-full space-y-5 animate-in fade-in duration-150">
      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="font-medium">{successMsg}</span>
        </div>
      )}

      {/* Tabs & Top Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200/80 gap-2 pb-1 sm:pb-0">
        <div className="flex overflow-x-auto whitespace-nowrap scrollbar-none gap-1">
          <button
            onClick={() => { setActiveTab('AI'); setTestResult(null); }}
            className={`px-3.5 py-2.5 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'AI' 
                ? 'border-indigo-600 text-indigo-600' 
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <BrainCircuit className="w-3.5 h-3.5" />
            AI 创作模型
          </button>
          <button
            onClick={() => { setActiveTab('SERP'); setTestResult(null); }}
            className={`px-3.5 py-2.5 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'SERP' 
                ? 'border-indigo-600 text-indigo-600' 
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            SERP 数据源
          </button>
          <button
            onClick={() => { setActiveTab('MEDIA'); setTestResult(null); }}
            className={`px-3.5 py-2.5 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'MEDIA' 
                ? 'border-indigo-600 text-indigo-600' 
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Image className="w-3.5 h-3.5" />
            配图服务
          </button>
          <button
            onClick={() => { setActiveTab('BLOCKCHAIN'); setTestResult(null); }}
            className={`px-3.5 py-2.5 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'BLOCKCHAIN' 
                ? 'border-indigo-600 text-indigo-600' 
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            USDT 充值网关
          </button>
        </div>

        <div className="py-1 sm:py-0 flex justify-end shrink-0">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-xs transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            校验并保存配置
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        
        {/* Left Side: Parameters Forms */}
        <div className="lg:col-span-2 space-y-4">
          
          {/* TAB 1: AI Engine */}
          {activeTab === 'AI' && (
            <div className="bg-white border border-slate-200/80 rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-800">AI 创作与 SEO 意图生成引擎参数</span>
                <span className="text-[11px] text-slate-500">符合 Gemini API 规范</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">服务提供商</label>
                  <select
                    value={config.aiEngine.provider}
                    onChange={(e) => setConfig({
                      ...config,
                      aiEngine: { ...config.aiEngine, provider: e.target.value as any }
                    })}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md bg-white focus:border-indigo-500"
                  >
                    <option value="GEMINI">Google Gemini (推荐)</option>
                    <option value="OPENAI_COMPATIBLE">OpenAI 兼容端点</option>
                    <option value="AZURE_OPENAI">Azure OpenAI</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-medium text-slate-700">主模型标识 <span className="text-rose-500">*</span></label>
                    <span className="text-[10px] text-slate-400">如 gemini-3.7-flash</span>
                  </div>
                  <input
                    type="text"
                    value={config.aiEngine.geminiModel}
                    onChange={(e) => {
                      setConfig({
                        ...config,
                        aiEngine: { ...config.aiEngine, geminiModel: e.target.value }
                      });
                      if (fieldErrors['aiEngine.geminiModel']) {
                        setFieldErrors({ ...fieldErrors, ['aiEngine.geminiModel']: '' });
                      }
                    }}
                    className={`w-full text-xs px-2.5 py-1.5 border rounded-md focus:border-indigo-500 ${
                      fieldErrors['aiEngine.geminiModel'] ? 'border-rose-300 bg-rose-50/30' : 'border-slate-200/80'
                    }`}
                    placeholder="gemini-3.7-flash 或 gpt-4o"
                  />
                  {fieldErrors['aiEngine.geminiModel'] && (
                    <p className="text-[11px] text-rose-600">{fieldErrors['aiEngine.geminiModel']}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">备用模型标识</label>
                  <input
                    type="text"
                    value={config.aiEngine.fallbackModel || ''}
                    onChange={(e) => setConfig({
                      ...config,
                      aiEngine: { ...config.aiEngine, fallbackModel: e.target.value }
                    })}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md focus:border-indigo-500"
                    placeholder="gemini-1.5-flash"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-medium text-slate-700">生成温度 ({config.aiEngine.temperature})</label>
                    <span className="text-[10px] text-slate-400">标准范围 0.0 ~ 2.0</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0"
                      max="2.0"
                      step="0.1"
                      value={config.aiEngine.temperature}
                      onChange={(e) => setConfig({
                        ...config,
                        aiEngine: { ...config.aiEngine, temperature: parseFloat(e.target.value) }
                      })}
                      className="w-full accent-indigo-600"
                    />
                    <span className="text-xs font-mono font-medium text-slate-700 w-8 text-right">
                      {config.aiEngine.temperature}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-medium text-slate-700">最大输出 Token</label>
                    <span className="text-[10px] text-slate-400">256 ~ 32768</span>
                  </div>
                  <input
                    type="number"
                    min="256"
                    max="32768"
                    value={config.aiEngine.maxOutputTokens}
                    onChange={(e) => setConfig({
                      ...config,
                      aiEngine: { ...config.aiEngine, maxOutputTokens: parseInt(e.target.value) || 2048 }
                    })}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-medium text-slate-700">最大并发数</label>
                    <span className="text-[10px] text-slate-400">1 ~ 50</span>
                  </div>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={config.aiEngine.maxConcurrency}
                    onChange={(e) => setConfig({
                      ...config,
                      aiEngine: { ...config.aiEngine, maxConcurrency: parseInt(e.target.value) || 5 }
                    })}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md focus:border-indigo-500 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-medium text-slate-700">自定义接口端点 (Endpoint)</label>
                  <span className="text-[10px] text-slate-400">需带 http:// 或 https://</span>
                </div>
                <input
                  type="text"
                  value={config.aiEngine.customEndpoint || ''}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      aiEngine: { ...config.aiEngine, customEndpoint: e.target.value }
                    });
                    if (fieldErrors['aiEngine.customEndpoint']) {
                      setFieldErrors({ ...fieldErrors, ['aiEngine.customEndpoint']: '' });
                    }
                  }}
                  className={`w-full text-xs px-2.5 py-1.5 border rounded-md focus:border-indigo-500 font-mono ${
                    fieldErrors['aiEngine.customEndpoint'] ? 'border-rose-300 bg-rose-50/30' : 'border-slate-200/80'
                  }`}
                  placeholder="留空使用 Google 官方默认端点，中转可填 https://api.openai.com/v1"
                />
                {fieldErrors['aiEngine.customEndpoint'] && (
                  <p className="text-[11px] text-rose-600">{fieldErrors['aiEngine.customEndpoint']}</p>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-medium text-slate-700">自定义 API Key</label>
                  <button 
                    type="button" 
                    onClick={() => setShowGeminiKey(!showGeminiKey)} 
                    className="text-xs text-indigo-600 hover:underline flex items-center gap-1 font-normal"
                  >
                    {showGeminiKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    {showGeminiKey ? '隐藏' : '显示'}
                  </button>
                </div>
                <input
                  type={showGeminiKey ? "text" : "password"}
                  value={config.aiEngine.customApiKey || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    aiEngine: { ...config.aiEngine, customApiKey: e.target.value }
                  })}
                  className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md focus:border-indigo-500 font-mono"
                  placeholder="留空则自动读取服务端环境变量 GEMINI_API_KEY"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">全局 SEO 架构系统提示词 (System Prompt)</label>
                <textarea
                  rows={3}
                  value={config.aiEngine.systemPromptPrefix || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    aiEngine: { ...config.aiEngine, systemPromptPrefix: e.target.value }
                  })}
                  className="w-full text-xs p-2.5 border border-slate-200/80 rounded-md focus:border-indigo-500"
                  placeholder="输入大模型全局角色设定与指令"
                />
              </div>
            </div>
          )}

          {/* TAB 3: SERP Keywords */}
          {activeTab === 'SERP' && (
            <div className="bg-white border border-slate-200/80 rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-800">SERP 关键词数据源与热度分析</span>
                <span className="text-[11px] text-slate-500">支持混合智能探针与商业 SERP 接口</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">数据源提供商</label>
                  <select
                    value={config.serpData.provider}
                    onChange={(e) => setConfig({
                      ...config,
                      serpData: { ...config.serpData, provider: e.target.value as any }
                    })}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md bg-white focus:border-indigo-500"
                  >
                    <option value="HYBRID_ENGINE">混合智能探针 (默认高性价比)</option>
                    <option value="SERPAPI">Serper / SerpAPI</option>
                    <option value="GOOGLE_CSE">Google 自定义搜索 API</option>
                    <option value="DATAFORSEO">DataForSEO</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-medium text-slate-700">LRU 缓存时长 (小时)</label>
                    <span className="text-[10px] text-slate-400">1 ~ 720 小时</span>
                  </div>
                  <input
                    type="number"
                    min="1"
                    max="720"
                    value={config.serpData.cacheTtlHours}
                    onChange={(e) => setConfig({
                      ...config,
                      serpData: { ...config.serpData, cacheTtlHours: parseInt(e.target.value) || 24 }
                    })}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">默认地区 (ISO 地区码)</label>
                  <input
                    type="text"
                    value={config.serpData.defaultLocation}
                    onChange={(e) => setConfig({
                      ...config,
                      serpData: { ...config.serpData, defaultLocation: e.target.value }
                    })}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md focus:border-indigo-500"
                    placeholder="US, CN, HK, GB"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">默认语言 (ISO 语言代码)</label>
                  <input
                    type="text"
                    value={config.serpData.defaultLanguage}
                    onChange={(e) => setConfig({
                      ...config,
                      serpData: { ...config.serpData, defaultLanguage: e.target.value }
                    })}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md focus:border-indigo-500"
                    placeholder="en, zh, ja, es"
                  />
                </div>
              </div>

              {/* Serper / SerpAPI Key */}
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-medium text-slate-700">Serper / SerpAPI Key</label>
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
                  className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md font-mono"
                  placeholder="Serper.dev 或 SerpAPI 密钥"
                />
              </div>

              {/* Google CSE Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Google CSE Key</label>
                  <input
                    type="text"
                    value={config.serpData.googleCseKey || ''}
                    onChange={(e) => setConfig({
                      ...config,
                      serpData: { ...config.serpData, googleCseKey: e.target.value }
                    })}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md font-mono"
                    placeholder="Google Custom Search API Key"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Google CSE CX</label>
                  <input
                    type="text"
                    value={config.serpData.googleCseCx || ''}
                    onChange={(e) => setConfig({
                      ...config,
                      serpData: { ...config.serpData, googleCseCx: e.target.value }
                    })}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md font-mono"
                    placeholder="搜索引擎 ID (CX)"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Media Services */}
          {activeTab === 'MEDIA' && (
            <div className="bg-white border border-slate-200/80 rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-800">配图生成与版权图库集成</span>
                <span className="text-[11px] text-slate-500">支持 AI 绘图与免版税正版图库</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">配图引擎</label>
                  <select
                    value={config.mediaService.imageProvider}
                    onChange={(e) => setConfig({
                      ...config,
                      mediaService: { ...config.mediaService, imageProvider: e.target.value as any }
                    })}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md bg-white focus:border-indigo-500"
                  >
                    <option value="GEMINI_IMAGEN">Gemini Imagen AI 绘画 (推荐)</option>
                    <option value="UNSPLASH">Unsplash 正版图库</option>
                    <option value="PEXELS">Pexels 免版税图库</option>
                    <option value="LOCAL_PLACEHOLDER">本地轻量占位图</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">构图比例</label>
                  <select
                    value={config.mediaService.imageOrientation}
                    onChange={(e) => setConfig({
                      ...config,
                      mediaService: { ...config.mediaService, imageOrientation: e.target.value as any }
                    })}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md bg-white focus:border-indigo-500"
                  >
                    <option value="landscape">横版 (16:9 推荐文章头图)</option>
                    <option value="squarish">方形 (1:1)</option>
                    <option value="portrait">竖版 (3:4)</option>
                  </select>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg space-y-2.5 border border-slate-200/80">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-700 font-medium">自动生成 Alt 标签与图注 (提升 Google 图片收录)</span>
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
                    <div className="w-8 h-4.5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between border-t border-slate-200/80 pt-2">
                  <span className="text-xs text-slate-700 font-medium">自动转 WebP 格式压缩 (优化 Core Web Vitals)</span>
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
                    <div className="w-8 h-4.5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>
              </div>

              {config.mediaService.imageProvider === 'UNSPLASH' && (
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-slate-700">Unsplash Access Key</label>
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
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md font-mono"
                    placeholder="Unsplash Developer Access Key"
                  />
                </div>
              )}

              {config.mediaService.imageProvider === 'PEXELS' && (
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-slate-700">Pexels API Key</label>
                    <button 
                      type="button" 
                      onClick={() => setShowPexelsKey(!showPexelsKey)} 
                      className="text-[10px] text-indigo-600 hover:underline"
                    >
                      {showPexelsKey ? '隐藏' : '显示'}
                    </button>
                  </div>
                  <input
                    type={showPexelsKey ? "text" : "password"}
                    value={config.mediaService.pexelsApiKey || ''}
                    onChange={(e) => setConfig({
                      ...config,
                      mediaService: { ...config.mediaService, pexelsApiKey: e.target.value }
                    })}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md font-mono"
                    placeholder="Pexels API Key"
                  />
                </div>
              )}
            </div>
          )}

          {/* TAB 5: Blockchain Gateways */}
          {activeTab === 'BLOCKCHAIN' && (
            <div className="bg-white border border-slate-200/80 rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-800">TRC-20 链上资金网关与节点设置</span>
                <span className="text-[11px] text-slate-500">波场智能合约监听标准</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">主网协议</label>
                  <select
                    value={config.blockchainGateway.network}
                    onChange={(e) => setConfig({
                      ...config,
                      blockchainGateway: { ...config.blockchainGateway, network: e.target.value as any }
                    })}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md bg-white focus:border-indigo-500"
                  >
                    <option value="TRC20">TRON (TRC-20 USDT)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-medium text-slate-700">安全区块确认数</label>
                    <span className="text-[10px] text-slate-400">标准推荐 19 块</span>
                  </div>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={config.blockchainGateway.requiredConfirmations}
                    onChange={(e) => setConfig({
                      ...config,
                      blockchainGateway: { ...config.blockchainGateway, requiredConfirmations: parseInt(e.target.value) || 19 }
                    })}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-medium text-slate-700">轮询间隔 (秒)</label>
                    <span className="text-[10px] text-slate-400">5 ~ 600 秒</span>
                  </div>
                  <input
                    type="number"
                    min="5"
                    max="600"
                    value={config.blockchainGateway.autoScanIntervalSeconds}
                    onChange={(e) => setConfig({
                      ...config,
                      blockchainGateway: { ...config.blockchainGateway, autoScanIntervalSeconds: parseInt(e.target.value) || 30 }
                    })}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-medium text-slate-700">RPC 节点地址</label>
                    <span className="text-[10px] text-slate-400">如 https://api.trongrid.io</span>
                  </div>
                  <input
                    type="text"
                    value={config.blockchainGateway.customRpcUrl || ''}
                    onChange={(e) => {
                      setConfig({
                        ...config,
                        blockchainGateway: { ...config.blockchainGateway, customRpcUrl: e.target.value }
                      });
                      if (fieldErrors['blockchainGateway.customRpcUrl']) {
                        setFieldErrors({ ...fieldErrors, ['blockchainGateway.customRpcUrl']: '' });
                      }
                    }}
                    className={`w-full text-xs px-2.5 py-1.5 border rounded-md focus:border-indigo-500 font-mono ${
                      fieldErrors['blockchainGateway.customRpcUrl'] ? 'border-rose-300 bg-rose-50/30' : 'border-slate-200/80'
                    }`}
                    placeholder="https://api.trongrid.io"
                  />
                  {fieldErrors['blockchainGateway.customRpcUrl'] && (
                    <p className="text-[11px] text-rose-600">{fieldErrors['blockchainGateway.customRpcUrl']}</p>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-medium text-slate-700">TronGrid 专有 API Key</label>
                  <button 
                    type="button" 
                    onClick={() => setShowTronGridKey(!showTronGridKey)} 
                    className="text-[10px] text-indigo-600 hover:underline"
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
                  className="w-full text-xs px-2.5 py-1.5 border border-slate-200/80 rounded-md focus:border-indigo-500 font-mono"
                  placeholder="TronGrid 专有 API Key"
                />
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Simple & Direct Test Panel */}
        <div className="space-y-4">
          <div className="bg-white border border-slate-200/80 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-1.5 pb-2 border-b border-slate-100">
              <Activity className="w-4 h-4 text-indigo-600" />
              <span className="text-xs font-bold text-slate-900">核心服务即时连通性测试</span>
            </div>

            <div className="space-y-1.5">
              <button
                onClick={() => handleTestConnection('GEMINI_AI', { apiKey: config.aiEngine.customApiKey, model: config.aiEngine.geminiModel })}
                disabled={testingService !== null}
                className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 text-xs rounded-md transition text-left cursor-pointer"
              >
                <span className="text-slate-700 font-medium">测试 AI 创作模型</span>
                {testingService === 'GEMINI_AI' ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                ) : (
                  <Play className="w-3 h-3 text-slate-400" />
                )}
              </button>

              <button
                onClick={() => handleTestConnection('TRON_GATEWAY', { customRpcUrl: config.blockchainGateway.customRpcUrl })}
                disabled={testingService !== null}
                className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 text-xs rounded-md transition text-left cursor-pointer"
              >
                <span className="text-slate-700 font-medium">测试 TRC20 节点</span>
                {testingService === 'TRON_GATEWAY' ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                ) : (
                  <Play className="w-3 h-3 text-slate-400" />
                )}
              </button>

              <button
                onClick={() => handleTestConnection('SERP_DATA', { provider: config.serpData.provider, apiKey: config.serpData.serpApiKey })}
                disabled={testingService !== null}
                className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 text-xs rounded-md transition text-left cursor-pointer"
              >
                <span className="text-slate-700 font-medium">测试 SERP 拓词数据源</span>
                {testingService === 'SERP_DATA' ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                ) : (
                  <Play className="w-3 h-3 text-slate-400" />
                )}
              </button>

              <button
                onClick={() => handleTestConnection('MEDIA_SERVICE', { provider: config.mediaService.imageProvider, unsplashKey: config.mediaService.unsplashAccessKey, pexelsKey: config.mediaService.pexelsApiKey })}
                disabled={testingService !== null}
                className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 text-xs rounded-md transition text-left cursor-pointer"
              >
                <span className="text-slate-700 font-medium">测试文章配图引擎</span>
                {testingService === 'MEDIA_SERVICE' ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                ) : (
                  <Play className="w-3 h-3 text-slate-400" />
                )}
              </button>
            </div>

            {/* Test Result Display */}
            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                  <Terminal className="w-3 h-3" />
                  测试结果
                </span>
                {testResult && (
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                    testResult.success ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'
                  }`}>
                    {testResult.success ? '成功' : '失败'}
                  </span>
                )}
              </div>

              <div className="bg-slate-50 p-2.5 rounded text-xs text-slate-700 min-h-[90px] max-h-[200px] overflow-y-auto">
                {testResult ? (
                  <div className="space-y-1.5 animate-in fade-in">
                    <div className="flex justify-between text-slate-500 text-[11px]">
                      <span>{testResult.service}</span>
                      <span className="flex items-center gap-0.5">
                        <Clock className="w-3 h-3" />
                        {testResult.latencyMs}ms
                      </span>
                    </div>
                    <div className={testResult.success ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>
                      {testResult.message}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-6 text-slate-400 text-xs">
                    点击上方按钮发起连通性测试
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

