import { describe, expect, it } from 'vitest';
import { RequestTooLargeError, ValidationError } from '../domain/errors';
import { cursorPage, normalizeHttpError } from './http';

describe('cursor pagination boundary', () => {
  it('accepts bounded integer page sizes and UUID cursors', () => {
    const cursor = '10000000-0000-4000-8000-000000000001';
    expect(cursorPage(cursor, '100')).toEqual({ cursor, take: 100 });
    expect(cursorPage(undefined, undefined)).toEqual({ cursor: undefined, take: 50 });
    expect(cursorPage(undefined, '')).toEqual({ cursor: undefined, take: 50 });
  });

  it.each([0, -10, 101, 1.5, '1.5', 'ten', ['10']])('rejects malformed page sizes: %s', (limit) => {
    expect(() => cursorPage(undefined, limit)).toThrow('分页数量必须是 1 到 100 的整数');
  });

  it.each(['not-a-uuid', '1 OR 1=1', ['uuid']])('rejects malformed cursors: %s', (cursor) => {
    expect(() => cursorPage(cursor, 50)).toThrow('分页游标无效');
  });
});

describe('HTTP parser error boundary', () => {
  it('returns a client validation error for malformed JSON instead of a 500', () => {
    const error = Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed' });
    const normalized = normalizeHttpError(error);
    expect(normalized).toBeInstanceOf(ValidationError);
    expect((normalized as ValidationError).statusCode).toBe(400);
    expect((normalized as ValidationError).message).toBe('请求正文不是有效的 JSON');
  });

  it('returns 413 when the body parser rejects an oversized request', () => {
    const error = Object.assign(new Error('request entity too large'), { type: 'entity.too.large' });
    const normalized = normalizeHttpError(error);
    expect(normalized).toBeInstanceOf(RequestTooLargeError);
    expect((normalized as RequestTooLargeError).statusCode).toBe(413);
  });

  it('does not trust arbitrary status fields on unknown errors', () => {
    const error = Object.assign(new Error('untrusted'), { status: 400 });
    expect(normalizeHttpError(error)).toBe(error);
  });
});
