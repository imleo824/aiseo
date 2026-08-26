import { generateKeyPairSync } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { indexingCircuitBreaker } from '../resilience/circuitBreaker';
import { SearchEngineAdapter } from './searchEngineAdapter';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

const serviceAccountJson = () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return JSON.stringify({
    type: 'service_account',
    client_email: 'seo-bot@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    token_uri: 'https://oauth2.googleapis.com/token'
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
  indexingCircuitBreaker.reset();
});

describe('SearchEngineAdapter Google Indexing API', () => {
  it('does not claim a submission when no credential is configured', async () => {
    const result = await new SearchEngineAdapter().pushToGoogle('example.com', undefined, ['https://example.com/article']);
    expect(result).toMatchObject({ success: true, skipped: true });
  });

  it('tests credentials through Google OAuth without submitting a fabricated URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'token-1' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new SearchEngineAdapter().testGoogleCredentials(serviceAccountJson());

    expect(result).toMatchObject({ success: true, statusCode: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token');
  });

  it('only reports success after OAuth and the real Indexing API both accept the URL', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1' }))
      .mockResolvedValueOnce(jsonResponse({ urlNotificationMetadata: {} }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new SearchEngineAdapter().pushToGoogle('example.com', serviceAccountJson(), ['https://example.com/jobs/42']);

    expect(result).toMatchObject({ success: true, statusCode: 200 });
    expect(fetchMock.mock.calls[1][0]).toBe('https://indexing.googleapis.com/v3/urlNotifications:publish');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ headers: expect.objectContaining({ Authorization: 'Bearer token-1' }) });
  });
});
