import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';

afterEach(() => vi.restoreAllMocks());

describe('structured logger', () => {
  it('routes info, warning and error records to the correct console channel', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logger.info('HTTP', 'request complete', { traceId: 'trace-123456', durationMs: 18, data: { status: 200 } });
    logger.warn('QUEUE', 'backlog', { tenantId: 'tenant-a' });
    logger.error('PAYMENT', 'verification failed', { data: new Error('provider timeout') });

    expect(log).toHaveBeenCalledWith(expect.stringContaining('[INFO] [HTTP]'), { status: 200 });
    expect(log.mock.calls[0][0]).toContain('(trace:123456)');
    expect(log.mock.calls[0][0]).toContain('+18ms');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[WARN] [QUEUE]'), '');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[ERROR] [PAYMENT]'), expect.any(Error));
  });

  it('profiles successful and failed operations without assuming error types', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(100).mockReturnValueOnce(125).mockReturnValueOnce(200).mockReturnValueOnce(245);

    const duration = logger.profile('SEO', 'discover', { traceId: 'trace-a', tenantId: 'tenant-a' }).done(undefined, { opportunities: 2 });
    const failedDuration = logger.profile('SEO', 'execute', 'trace-b').fail('quality blocked');

    expect(duration).toBe(25);
    expect(failedDuration).toBe(45);
    expect(info).toHaveBeenCalledWith('SEO', 'discover completed', expect.objectContaining({ traceId: 'trace-a', tenantId: 'tenant-a', durationMs: 25 }));
    expect(error).toHaveBeenCalledWith('SEO', 'execute failed after 45ms: quality blocked', expect.objectContaining({ traceId: 'trace-b', durationMs: 45 }));
  });
});
