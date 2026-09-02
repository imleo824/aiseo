// Vite-only development fallback. The production Web service replaces this
// response at runtime with its browser-safe Supabase configuration.
globalThis.__AISEO_RUNTIME_CONFIG__ = Object.freeze({
  supabaseUrl: '',
  supabasePublishableKey: '',
  turnstileSiteKey: '',
  sentryDsn: '',
  sentryTracesSampleRate: '0.1',
  release: ''
});
