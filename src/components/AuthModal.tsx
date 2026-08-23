import React, { useState } from 'react';
import { 
  X, 
  Lock, 
  User, 
  Mail, 
  Building2, 
  Sparkles, 
  ShieldAlert,
  KeyRound
} from 'lucide-react';
import { TenantAccount } from '../types/seo';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAccount: TenantAccount | null;
  onLogin: (usernameOrEmail: string, password?: string) => Promise<any>;
  onRegister: (data: { username: string; email: string; password?: string; companyName?: string }) => Promise<any>;
  isMandatoryLogin?: boolean;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onLogin,
  onRegister,
  isMandatoryLogin = false
}) => {
  const [tab, setTab] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameOrEmail.trim()) {
      setError('请输入用户名或电子邮箱');
      return;
    }
    if (!password) {
      setError('请输入密码');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await onLogin(usernameOrEmail.trim(), password);
      onClose();
    } catch (err: any) {
      setError(err?.message || '登录失败，请核对账号与密码');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regUsername.trim() || !regEmail.trim() || !regPassword.trim()) {
      setError('用户名、电子邮箱与密码均为必填项');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await onRegister({
        username: regUsername.trim(),
        email: regEmail.trim(),
        password: regPassword.trim(),
        companyName: companyName.trim() || undefined
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || '注册失败，用户名或邮箱可能已存在');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn">
      <div 
        id="auth-modal-card" 
        className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold">
              ⚡
            </div>
            <div>
              <h3 className="text-base font-bold text-white">身份验证与权限控制</h3>
              <p className="text-xs text-slate-400">真实生产模式 · 严格数据隔离与鉴权</p>
            </div>
          </div>
          {!isMandatoryLogin && (
            <button 
              id="btn-close-auth-modal"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-950/50 p-1">
          <button
            type="button"
            onClick={() => { setTab('LOGIN'); setError(null); }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              tab === 'LOGIN' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            账号登录
          </button>
          <button
            type="button"
            onClick={() => { setTab('REGISTER'); setError(null); }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              tab === 'REGISTER' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            注册新账号 (+100 积分)
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {tab === 'LOGIN' && (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              {/* Quick Login Credentials for Testing */}
              <div className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl space-y-1.5">
                <div className="text-[11px] font-semibold text-slate-300">
                  预置测试账号凭证 (可点击快速一键填充)：
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setUsernameOrEmail('admin');
                      setPassword('admin123');
                      setError(null);
                    }}
                    className="p-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-left transition-colors cursor-pointer"
                  >
                    <div className="text-xs font-bold text-amber-300 flex items-center gap-1">
                      <span>👑 平台管理员</span>
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">admin / admin123</div>
                    <div className="text-[9px] text-amber-400/90 mt-0.5">配置系统价格与套餐</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setUsernameOrEmail('matrix_seo');
                      setPassword('password123');
                      setError(null);
                    }}
                    className="p-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-left transition-colors cursor-pointer"
                  >
                    <div className="text-xs font-bold text-emerald-300 flex items-center gap-1">
                      <span>🏢 企业租户</span>
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">matrix_seo</div>
                    <div className="text-[9px] text-emerald-400/90 mt-0.5">普通发文与消费</div>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">用户名 或 邮箱</label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={usernameOrEmail}
                    onChange={(e) => setUsernameOrEmail(e.target.value)}
                    placeholder="输入您的用户名或登录邮箱"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">登录密码</label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入账号密码"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs transition-all shadow-md shadow-emerald-500/20 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {loading ? '正在校验身份并登录...' : '安全登录'}
                </button>
              </div>

              <div className="text-center pt-2">
                <span className="text-xs text-slate-400">
                  尚未注册？
                  <button 
                    type="button" 
                    onClick={() => { setTab('REGISTER'); setError(null); }} 
                    className="text-emerald-400 hover:underline font-semibold ml-1 cursor-pointer"
                  >
                    注册新账号 (送 100 积分体验)
                  </button>
                </span>
              </div>
            </form>
          )}

          {tab === 'REGISTER' && (
            <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">用户名 / 租户标识 *</label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    placeholder="设置用户名 (如: global_seo_team)"
                    className="w-full pl-9 pr-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">电子邮箱 *</label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="输入电子邮箱 (如: admin@company.com)"
                    className="w-full pl-9 pr-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">登录密码 *</label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="设置安全密码"
                    className="w-full pl-9 pr-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">公司 / 矩阵名称 (选填)</label>
                <div className="relative">
                  <Building2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="如: 极光出海科技"
                    className="w-full pl-9 pr-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                <span>注册即赠送 <strong>100 积分</strong>，可立即用于 AI 发文与站点管理！</span>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 bg-gradient-to-r from-emerald-500 to-amber-500 hover:from-emerald-400 hover:to-amber-400 text-slate-950 font-bold rounded-xl text-xs transition-all shadow-md shadow-emerald-500/20 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {loading ? '正在创建账户...' : '确认注册并自动登录'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

