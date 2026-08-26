import { lazy, Suspense } from 'react';

const ProductionConsole = lazy(() => import('./components/ProductionConsole').then(({ ProductionConsole }) => ({ default: ProductionConsole })));
const LegacyApp = lazy(() => import('./LegacyApp'));

export default function App() {
  const useV1Console = import.meta.env.VITE_USE_V1 === 'true';
  return <Suspense fallback={<div className="min-h-screen grid place-items-center bg-slate-950 text-slate-100">正在加载工作区…</div>}>
    {useV1Console ? <ProductionConsole /> : <LegacyApp />}
  </Suspense>;
}
