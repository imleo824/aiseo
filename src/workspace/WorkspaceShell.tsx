import { lazy, Suspense, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useWorkspace } from './WorkspaceContext';
import { LegalLinks } from '../components/LegalLinks';

const OverviewPage = lazy(() => import('../pages/OverviewPage'));
const SitesPage = lazy(() => import('../pages/SitesPage'));
const ContentPage = lazy(() => import('../pages/ContentPage'));
const BillingPage = lazy(() => import('../pages/BillingPage'));
const AdminPage = lazy(() => import('../pages/AdminPage'));

const tabs = [
  ['overview', '概览'], ['sites', '站点与连接'], ['content', '内容流水线'], ['billing', '充值与账本']
] as const;

export default function WorkspaceShell() {
  const { signOut } = useAuth();
  const { me, organization, setOrganizationId } = useWorkspace();
  const [tab, setTab] = useState<string>('overview');
  const availableTabs = me.profile.platformRole === 'PLATFORM_ADMIN' ? [...tabs, ['admin', '平台管理'] as const] : tabs;
  const page = tab === 'sites' ? <SitesPage /> : tab === 'content' ? <ContentPage /> : tab === 'billing' ? <BillingPage /> : tab === 'admin' ? <AdminPage /> : <OverviewPage />;
  return <div className="min-h-screen bg-slate-950 text-slate-100">
    <header className="border-b border-slate-800 bg-slate-950/90 sticky top-0 z-10 backdrop-blur">
      <div className="mx-auto max-w-7xl px-5 py-4 flex flex-wrap items-center gap-4">
        <div className="mr-auto"><p className="font-black tracking-wide text-cyan-400">AISEO</p><p className="text-xs text-slate-500">Production workspace</p></div>
        <select className="field !mt-0 !w-auto" value={organization.id} onChange={(event) => setOrganizationId(event.target.value)}>{me.organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <span className="text-sm text-slate-400">{me.profile.email}</span>
        <button className="secondary" onClick={() => void signOut()}>全局退出</button>
      </div>
      <nav className="mx-auto max-w-7xl px-5 flex gap-1 overflow-x-auto">{availableTabs.map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`nav-tab ${tab === id ? 'nav-tab-active' : ''}`}>{label}</button>)}</nav>
    </header>
    <main className="mx-auto max-w-7xl p-5"><Suspense fallback={<div className="screen-center">正在加载页面…</div>}>{page}</Suspense></main>
    <footer className="border-t border-slate-900 py-8"><LegalLinks /></footer>
  </div>;
}
