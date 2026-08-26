import { lazy, Suspense } from 'react';

const WorkspaceApp = lazy(() => import('./LegacyApp'));

export default function App() {
  return <Suspense fallback={<div className="min-h-screen grid place-items-center bg-slate-950 text-slate-100">正在加载工作区…</div>}>
    <WorkspaceApp />
  </Suspense>;
}
