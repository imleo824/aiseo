import { describe, expect, it } from 'vitest';
import { stripSensitiveRequestData } from './instrument';

describe('telemetry request redaction', () => {
  it('removes callback secrets before events leave the process', () => {
    const event = stripSensitiveRequestData({
      request: {
        url: 'https://app.example.com/api/v1/integrations/wordpress/callback?password=secret&state=signed',
        query_string: 'password=secret&state=signed',
        data: { password: 'secret' },
        cookies: { session: 'secret' }
      }
    });

    expect(event.request).toEqual({
      url: 'https://app.example.com/api/v1/integrations/wordpress/callback',
      query_string: undefined,
      data: undefined,
      cookies: undefined
    });
  });
});
