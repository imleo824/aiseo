import { lazy, Suspense } from 'react';
import { useAuth } from './auth/AuthProvider';
import { AuthScreen } from './components/auth/AuthScreen';
import { LegalDocumentPage, legalDocumentForPath } from './components/LegalDocumentPage';
import { resolveAuthView } from './auth/authFlow';

const WorkspaceApp = lazy(() => import('./WorkspaceApp'));

export default function App() {
  const { user, loading, recovery } = useAuth();
  const legalDocument = legalDocumentForPath(window.location.pathname);
  if (legalDocument) return <LegalDocumentPage documentPath={legalDocument} />;
  const view = resolveAuthView({ loading, recovery, hasUser: Boolean(user), emailConfirmed: Boolean(user?.email_confirmed_at) });
  if (view === 'LOADING') return <div className="screen-center">正在校验会话…</div>;
  if (view === 'LOGIN' || view === 'RECOVERY') return <AuthScreen />;
  if (view === 'VERIFY_EMAIL') return <main className="screen-center p-6"><div className="panel max-w-lg"><h1 className="page-title">请验证邮箱</h1><p className="muted mt-2">邮箱验证完成后即可登录、连接站点并使用增长功能。</p></div></main>;
  if (!user) return <AuthScreen />;
  return <Suspense fallback={<div className="screen-center">正在加载工作区…</div>}><WorkspaceApp key={user.id} authUserId={user.id} /></Suspense>;
}
