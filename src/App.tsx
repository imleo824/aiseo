import { lazy, Suspense } from 'react';

const ProductionConsole = lazy(() => import('./components/ProductionConsole').then(({ ProductionConsole }) => ({ default: ProductionConsole })));
// Vite replaces DEV at build time, so the legacy/demo UI is tree-shaken from
// production artifacts instead of merely being hidden behind a runtime branch.
const LegacyApp = import.meta.env.DEV ? lazy(() => import('./LegacyApp')) : null;

export default function App() {
  const productionRuntime = import.meta.env.PROD || import.meta.env.VITE_USE_V1 === 'true';
  return <Suspense fallback={<div className="min-h-screen grid place-items-center bg-slate-950 text-slate-100">正在加载工作区…</div>}>
    {productionRuntime || !LegacyApp ? <ProductionConsole /> : <LegacyApp />}
  </Suspense>;
}
