import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { AuthProvider } from './auth/AuthProvider.tsx';
import { missingSupabaseBrowserConfiguration } from './lib/supabase.ts';
import './index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: (failures, error) => failures < 2 && !(error instanceof Error && 'status' in error && (error as { status?: number }).status === 401), refetchOnWindowFocus: true }, mutations: { retry: false } } });
if (import.meta.env.VITE_SENTRY_DSN) Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN, environment: import.meta.env.MODE, release: import.meta.env.VITE_RELEASE, tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0.1), sendDefaultPii: false });

const root = createRoot(document.getElementById('root')!);

if (missingSupabaseBrowserConfiguration) {
  root.render(
    <StrictMode>
      <main className="screen-center p-6">
        <section className="panel max-w-lg" role="alert">
          <h1 className="page-title">应用尚未完成配置</h1>
          <p className="muted mt-2">请在部署服务中设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_PUBLISHABLE_KEY，然后重新构建并部署。</p>
        </section>
      </main>
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider><App /></AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}
