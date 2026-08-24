import React, { useState } from 'react';
import { 
  X, 
  Lock, 
  User, 
  Mail, 
  Building2, 
  Sparkles, 
  ShieldAlert,
  KeyRound,
  Check
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        id="auth-modal-card" 
        className="relative w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-sm shadow-xs">
              <Sparkles className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">租户登录与安全隔离</h3>
            </div>
          </div>
          {!isMandatoryLogin && (
            <button 
              id="btn-close-auth-modal"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 bg-slate-100/70 p-1.5 gap-1">
          <button
            type="button"
            onClick={() => { setTab('LOGIN'); setError(null); }}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
              tab === 'LOGIN' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            账号登录
          </button>
          <button
            type="button"
            onClick={() => { setTab('REGISTER'); setError(null); }}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
              tab === 'REGISTER' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            注册新账号 (+100 积分)
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {tab === 'LOGIN' && (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              {/* Quick Login Credentials for Testing */}
              <div className="p-3 bg-slate-50 border border-slate-200/90 rounded-2xl space-y-2">
                <div className="text-xs font-bold text-slate-700">
                  预置测试账号凭证（点击快速填充）：
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setUsernameOrEmail('admin');
                      setPassword('admin123');
                      setError(null);
                    }}
                    className="p-2.5 rounded-xl bg-white hover:bg-amber-50/60 border border-slate-200 hover:border-amber-300 text-left transition cursor-pointer shadow-2xs"
                  >
                    <div className="text-xs font-bold text-amber-700 flex items-center gap-1">
                      <span>👑 管理员账号</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">admin / admin123</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">配置系统价格与套餐</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setUsernameOrEmail('matrix_seo');
                      setPassword('password123');
                      setError(null);
                    }}
                    className="p-2.5 rounded-xl bg-white hover:bg-emerald-50/60 border border-slate-200 hover:border-emerald-300 text-left transition cursor-pointer shadow-2xs"
                  >
                    <div className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                      <span>🏢 企业租户账号</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">matrix_seo</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">普通发文与日常消费</div>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">用户名 或 邮箱</label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={usernameOrEmail}
                    onChange={(e) => setUsernameOrEmail(e.target.value)}
                    placeholder="输入用户名或登录邮箱"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs font-medium focus:bg-white focus:outline-none focus:border-slate-400 transition"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">登录密码</label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入账号密码"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs font-medium focus:bg-white focus:outline-none focus:border-slate-400 transition"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition shadow-sm active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {loading ? '正在校验身份并登录...' : '安全登录'}
                </button>
              </div>

              <div className="text-center pt-1">
                <span className="text-xs text-slate-500">
                  尚未注册？
                  <button 
                    type="button" 
                    onClick={() => { setTab('REGISTER'); setError(null); }} 
                    className="text-emerald-700 hover:underline font-bold ml-1 cursor-pointer"
                  >
                    注册新账号 (送 100 积分体验)
                  </button>
                </span>
              </div>
            </form>
          )}

          {tab === 'REGISTER' && (
            <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">用户名 / 租户标识 *</label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    placeholder="设置用户名 (如 global_seo_team)"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs font-medium focus:bg-white focus:outline-none focus:border-slate-400 transition"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">电子邮箱 *</label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="输入电子邮箱 (如 admin@company.com)"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs font-medium focus:bg-white focus:outline-none focus:border-slate-400 transition"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">登录密码 *</label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="设置安全密码"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs font-medium focus:bg-white focus:outline-none focus:border-slate-400 transition"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">公司 / 矩阵名称 (选填)</label>
                <div className="relative">
                  <Building2 className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="如：极光出海科技"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs font-medium focus:bg-white focus:outline-none focus:border-slate-400 transition"
                  />
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                <span>注册即赠送 <strong>100 积分</strong>，可立即体验 AI 全自动发文！</span>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition shadow-sm active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
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

