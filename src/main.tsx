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
const browserConfig = globalThis.__AISEO_RUNTIME_CONFIG__;
const browserSentryDsn = browserConfig?.sentryDsn || import.meta.env.VITE_SENTRY_DSN;
const requestedTraceRate = Number(browserConfig?.sentryTracesSampleRate || import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0.1);
const tracesSampleRate = Number.isFinite(requestedTraceRate) && requestedTraceRate >= 0 && requestedTraceRate <= 1 ? requestedTraceRate : 0.1;
if (browserSentryDsn) Sentry.init({ dsn: browserSentryDsn, environment: import.meta.env.MODE, release: browserConfig?.release || import.meta.env.VITE_RELEASE, tracesSampleRate, sendDefaultPii: false });

const root = createRoot(document.getElementById('root')!);

if (missingSupabaseBrowserConfiguration) {
  root.render(
    <StrictMode>
      <main className="screen-center p-6">
        <section className="panel max-w-lg" role="alert">
          <h1 className="page-title">应用尚未完成配置</h1>
          <p className="muted mt-2">请在 Web 服务中设置 SUPABASE_URL 和 SUPABASE_PUBLISHABLE_KEY，然后重新启动服务。</p>
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
