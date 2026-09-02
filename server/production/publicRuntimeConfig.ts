export type PublicRuntimeConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  turnstileSiteKey: string;
  sentryDsn: string;
  sentryTracesSampleRate: string;
  release: string;
};

export const serializePublicRuntimeConfig = (config: PublicRuntimeConfig): string =>
  `globalThis.__AISEO_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify(config)});`;
