/// <reference types="vite/client" />

declare global {
  var __AISEO_RUNTIME_CONFIG__: {
    supabaseUrl: string;
    supabasePublishableKey: string;
    turnstileSiteKey: string;
    sentryDsn: string;
    sentryTracesSampleRate: string;
    release: string;
  } | undefined;
}

export {};
