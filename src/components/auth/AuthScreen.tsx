import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthProvider';
import { LegalLinks } from '../LegalLinks';

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
  if (!turnstileSiteKey) return <p className="text-xs text-slate-400 py-1">（当前环境无需人机验证）</p>;
  return <div ref={container} />;
}

export function AuthScreen() {
  const { recovery } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'recovery'>(recovery ? 'recovery' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (recovery) setMode('recovery'); }, [recovery]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        if (turnstileSiteKey && !captchaToken) throw new Error('请先完成人机验证');
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            captchaToken: captchaToken || undefined,
            data: { display_name: displayName },
            emailRedirectTo: window.location.origin
          }
        });
        if (error) throw error;
        setMessage('验证邮件已发送。完成邮箱验证后才能创建组织。');
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) throw error;
        setMessage('密码重置邮件已发送。');
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setMessage('密码已更新，请重新登录。');
        await supabase.auth.signOut({ scope: 'global' });
        setMode('login');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败'); }
    finally { setBusy(false); }
  };

  return (
    <main className="min-h-[100dvh] bg-slate-50/80 text-slate-900 flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-md bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold tracking-wider uppercase text-slate-500">AI XEO</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold border border-slate-200/80">PRODUCTION</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-950 mt-2">
            {mode === 'login' ? '登录工作区' : mode === 'signup' ? '创建新账号' : mode === 'forgot' ? '找回账号密码' : '设置新密码'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {mode === 'login' ? '输入凭证进入搜索增长工作区' : mode === 'signup' ? '注册账号并配置自动化增长策略' : mode === 'forgot' ? '我们将向您的邮箱发送重置链接' : '请输入您的全新登录密码'}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === 'signup' && (
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">姓名</label>
              <input
                className="input-field"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="例如：张工"
                required
              />
            </div>
          )}

          {mode !== 'recovery' && (
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">工作邮箱</label>
              <input
                className="input-field"
                type="email"
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
                <label className="block text-xs font-semibold text-slate-700">密码</label>
                {mode === 'signup' && (
                  <span className="text-[11px] text-slate-400">最少 10 个字符</span>
                )}
              </div>
              <input
                className="input-field"
                type="password"
                minLength={10}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••••"
                required
              />
            </div>
          )}

          {mode === 'signup' && <Turnstile onToken={setCaptchaToken} />}

          {message && (
            <div
              role="alert"
              className="rounded-xl bg-slate-50 border border-slate-200/90 p-3 text-xs sm:text-sm text-slate-700 leading-relaxed"
            >
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="btn-primary w-full text-sm font-bold min-h-[44px] shadow-xs"
          >
            {busy ? '正在处理…' : '继续'}
          </button>

          <div className="flex items-center justify-between pt-1 text-xs text-slate-600 border-t border-slate-100">
            {mode !== 'login' && (
              <button
                type="button"
                onClick={() => setMode('login')}
                className="py-2 text-slate-600 hover:text-slate-950 font-medium transition cursor-pointer min-h-[40px] flex items-center"
              >
                ← 返回登录
              </button>
            )}
            {mode === 'login' && (
              <>
                <button
                  type="button"
                  onClick={() => setMode('signup')}
                  className="py-2 text-slate-950 font-semibold hover:underline transition cursor-pointer min-h-[40px] flex items-center"
                >
                  创建新账号
                </button>
                <button
                  type="button"
                  onClick={() => setMode('forgot')}
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
