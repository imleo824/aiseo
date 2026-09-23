import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getSupabaseBrowserClient } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthProvider';
import { LegalLinks } from '../LegalLinks';
import { AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { signOutEverywhere } from '../../auth/signOut';
import { authErrorMessage } from '../../auth/authErrors';

declare global {
  interface Window {
    turnstile?: { render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void }) => string; remove: (id: string) => void };
  }
}

const turnstileSiteKey = globalThis.__AISEO_RUNTIME_CONFIG__?.turnstileSiteKey || import.meta.env.VITE_TURNSTILE_SITE_KEY;

function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!turnstileSiteKey) return;
    const render = () => {
      if (!container.current || !window.turnstile || widgetId.current) return;
      widgetId.current = window.turnstile.render(container.current, { sitekey: turnstileSiteKey, callback: (token) => onToken(token), 'expired-callback': () => onToken(null) });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-aiseo-turnstile]');
    if (existing) { existing.addEventListener('load', render); render(); }
    else {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.dataset.aiseoTurnstile = 'true';
      script.addEventListener('load', render);
      document.head.appendChild(script);
    }
    return () => { if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current); };
  }, [onToken]);
  if (!turnstileSiteKey) return null;
  return <div ref={container} />;
}

export function AuthScreen() {
  const supabase = getSupabaseBrowserClient();
  const { recovery } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'recovery'>(recovery ? 'recovery' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaEpoch, setCaptchaEpoch] = useState(0);
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'success' | 'error'>('success');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (recovery) setMode('recovery'); }, [recovery]);
  const captchaRequired = Boolean(turnstileSiteKey && mode !== 'recovery');
  const changeMode = (nextMode: typeof mode) => {
    setMode(nextMode);
    setMessage('');
    setMessageKind('success');
    setPassword('');
    setShowPassword(false);
    setCaptchaToken(null);
    setCaptchaEpoch((value) => value + 1);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (captchaRequired && !captchaToken) {
      setMessageKind('error');
      setMessage('请先完成人机验证。');
      return;
    }
    setBusy(true);
    setMessage('');
    const normalizedEmail = email.trim().toLowerCase();
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
          options: { captchaToken: captchaToken || undefined }
        });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            captchaToken: captchaToken || undefined,
            emailRedirectTo: window.location.origin
          }
        });
        if (error) throw error;
        setMessageKind('success');
        setMessage('验证邮件已发送。完成邮箱验证后即可登录并连接站点。');
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: window.location.origin,
          captchaToken: captchaToken || undefined
        });
        if (error) throw error;
        setMessageKind('success');
        setMessage('密码重置邮件已发送。');
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setMessageKind('success');
        setMessage('密码已更新，请重新登录。');
        await signOutEverywhere(supabase.auth);
        setMode('login');
      }
    } catch (error) {
      setMessageKind('error');
      setMessage(authErrorMessage(error));
    }
    finally {
      setBusy(false);
      if (captchaRequired) {
        setCaptchaToken(null);
        setCaptchaEpoch((value) => value + 1);
      }
    }
  };

  return (
    <main className="min-h-[100dvh] bg-slate-50/80 text-slate-900 flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-md bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        <div>
          <span className="text-xs font-bold tracking-wider uppercase text-slate-500">TuiTui 推推</span>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-950 mt-2">
            {mode === 'login' ? '登录工作区' : mode === 'signup' ? '创建新账号' : mode === 'forgot' ? '找回账号密码' : '设置新密码'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {mode === 'login' ? '登录后管理您的网站增长' : mode === 'signup' ? '创建账号后即可连接网站' : mode === 'forgot' ? '我们会向您的邮箱发送重置链接' : '请输入新的登录密码'}
          </p>
        </div>

        <form onSubmit={submit} aria-busy={busy} className="space-y-4">
          {mode !== 'recovery' && (
            <div className="space-y-1.5">
              <label htmlFor="auth-email" className="block text-xs font-semibold text-slate-700">工作邮箱</label>
              <input
                id="auth-email"
                className="input-field"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
                required
              />
            </div>
          )}

          {mode !== 'forgot' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="auth-password" className="block text-xs font-semibold text-slate-700">密码</label>
                {mode === 'signup' && (
                  <span className="text-[11px] text-slate-400">最少 10 个字符</span>
                )}
              </div>
              <div className="relative">
                <input
                  id="auth-password"
                  className="input-field pr-12"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  minLength={mode === 'login' ? undefined : 10}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute inset-y-0 right-0 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-r-xl text-slate-400 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-900"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          {mode !== 'recovery' && <Turnstile key={`${mode}-${captchaEpoch}`} onToken={setCaptchaToken} />}

          {message && (
            <div
              role={messageKind === 'error' ? 'alert' : 'status'}
              aria-live={messageKind === 'error' ? 'assertive' : 'polite'}
              className={`flex items-start gap-2 rounded-xl border p-3 text-xs leading-relaxed sm:text-sm ${messageKind === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
            >
              {messageKind === 'error'
                ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{message}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="btn-primary w-full text-sm font-bold min-h-[44px] shadow-xs"
          >
            {busy
              ? '正在处理…'
              : mode === 'login'
                ? '登录'
                : mode === 'signup'
                  ? '创建账号'
                  : mode === 'forgot'
                    ? '发送重置邮件'
                    : '更新密码'}
          </button>

          <div className="flex items-center justify-between pt-1 text-xs text-slate-600 border-t border-slate-100">
            {mode !== 'login' && mode !== 'recovery' && (
              <button
                type="button"
                onClick={() => changeMode('login')}
                className="py-2 text-slate-600 hover:text-slate-950 font-medium transition cursor-pointer min-h-[40px] flex items-center"
              >
                ← 返回登录
              </button>
            )}
            {mode === 'login' && (
              <>
                <button
                  type="button"
                  onClick={() => changeMode('signup')}
                  className="py-2 text-slate-950 font-semibold hover:underline transition cursor-pointer min-h-[40px] flex items-center"
                >
                  创建新账号
                </button>
                <button
                  type="button"
                  onClick={() => changeMode('forgot')}
                  className="py-2 text-slate-500 hover:text-slate-800 transition cursor-pointer min-h-[40px] flex items-center"
                >
                  忘记密码？
                </button>
              </>
            )}
          </div>

          <div className="pt-2">
            <LegalLinks />
          </div>
        </form>
      </div>
    </main>
  );
}
