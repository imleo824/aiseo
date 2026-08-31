import { lazy, Suspense } from 'react';
import { useAuth } from './auth/AuthProvider';
import { AuthScreen } from './components/auth/AuthScreen';

const LegacyApp = lazy(() => import('./LegacyApp'));

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="screen-center">正在校验会话…</div>;
  if (!user) return <AuthScreen />;
  if (!user.email_confirmed_at) return <main className="screen-center p-6"><div className="panel max-w-lg"><h1 className="page-title">请验证邮箱</h1><p className="muted mt-2">邮箱验证完成前不能创建组织或使用付费资源。</p></div></main>;
  return <Suspense fallback={<div className="screen-center">正在加载工作区…</div>}><LegacyApp /></Suspense>;
}
