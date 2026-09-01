import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/networkSafety', () => ({
  resolvePublicHttpsOrigin: vi.fn(async () => 'https://example.com')
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

describe('capturePublicSource', () => {
  it('captures sanitized, checksummed text from the final HTTPS page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '<html><head><title> Safe Source </title></head><body><h1>Evidence</h1><p>' + 'grounded content '.repeat(12) + '</p><script>secret()</script></body></html>',
      { status: 200, headers: { 'content-type': 'text/html' } }
    )));
    const { capturePublicSource } = await import('./sourceFetcher');
    const source = await capturePublicSource('https://example.com/article?q=1');
    expect(source).toMatchObject({ normalizedUrl: 'https://example.com/article?q=1', title: 'Safe Source' });
    expect(source.content).toContain('Evidence');
    expect(source.content).not.toContain('secret()');
    expect(source.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects redirects instead of following an unvalidated destination', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 302, headers: { location: 'https://attacker.test' } })));
    const { capturePublicSource } = await import('./sourceFetcher');
    await expect(capturePublicSource('https://example.com')).rejects.toThrow('不允许重定向');
  });

  it('rejects a body declared above the maximum size before reading it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('small', { status: 200, headers: { 'content-type': 'text/plain', 'content-length': '2000001' } })));
    const { capturePublicSource } = await import('./sourceFetcher');
    await expect(capturePublicSource('https://example.com')).rejects.toThrow('超过 2MB');
  });
});
