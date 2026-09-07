import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy } from './app';

describe('content security policy', () => {
  it('allows the Vite React preamble only outside production', () => {
    const development = buildContentSecurityPolicy({
      runtime: 'development',
      supabaseUrl: 'https://project.supabase.co',
      sentryDsn: ''
    });
    const production = buildContentSecurityPolicy({
      runtime: 'production',
      supabaseUrl: 'https://project.supabase.co',
      sentryDsn: 'https://public@errors.example.com/1'
    });

    expect(development).toContain("script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com");
    expect(production).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(production).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(production).toContain('wss://project.supabase.co');
    expect(production).toContain('https://errors.example.com');
  });
});
