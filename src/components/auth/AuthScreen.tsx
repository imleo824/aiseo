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
  if (!turnstileSiteKey) return <p className="text-sm text-amber-300">注册验证尚未配置，公开注册已关闭。</p>;
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
        if (!captchaToken) throw new Error('请先完成人机验证');
        const { error } = await supabase.auth.signUp({ email, password, options: { captchaToken, data: { display_name: displayName }, emailRedirectTo: window.location.origin } });
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

  return <main className="min-h-screen bg-slate-950 text-slate-100 grid place-items-center p-6">
    <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl space-y-5">
      <div><p className="text-cyan-400 text-sm font-semibold">AISEO PRODUCTION</p><h1 className="text-2xl font-bold mt-1">{mode === 'login' ? '登录' : mode === 'signup' ? '创建账号' : mode === 'forgot' ? '找回密码' : '设置新密码'}</h1></div>
      {mode === 'signup' && <label className="block text-sm">姓名<input className="field" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>}
      {mode !== 'recovery' && <label className="block text-sm">邮箱<input className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>}
      {mode !== 'forgot' && <label className="block text-sm">密码<input className="field" type="password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>}
      {mode === 'signup' && <Turnstile onToken={setCaptchaToken} />}
      {message && <p className="rounded-lg bg-slate-800 p-3 text-sm text-slate-200">{message}</p>}
      <button disabled={busy || (mode === 'signup' && !turnstileSiteKey)} className="w-full rounded-lg bg-cyan-500 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50">{busy ? '处理中…' : '继续'}</button>
      <div className="flex flex-wrap gap-3 text-sm text-slate-400">
        {mode !== 'login' && <button type="button" onClick={() => setMode('login')}>返回登录</button>}
        {mode === 'login' && <><button type="button" onClick={() => setMode('signup')}>注册</button><button type="button" onClick={() => setMode('forgot')}>忘记密码</button></>}
      </div>
      <LegalLinks />
    </form>
  </main>;
}
