import { describe, expect, it } from 'vitest';
import { serializePublicRuntimeConfig } from './publicRuntimeConfig';

describe('public runtime configuration', () => {
  it('serializes only the explicitly allowlisted browser values', () => {
    const script = serializePublicRuntimeConfig({
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'sb_publishable_example',
      turnstileSiteKey: 'turnstile_public',
      sentryDsn: 'https://public@sentry.example/1',
      sentryTracesSampleRate: '0.1',
      release: 'commit-sha'
    });

    expect(script).toContain('https://project.supabase.co');
    expect(script).toContain('sb_publishable_example');
    expect(script).toContain('turnstile_public');
    expect(script).not.toContain('DATABASE');
    expect(script).not.toContain('SERVICE_ROLE');
    expect(script).not.toContain('APP_ENCRYPTION_KEY');
  });
});
