import { describe, expect, it } from 'vitest';
import { cursorPage } from './http';

describe('cursor pagination boundary', () => {
  it('bounds page size and accepts only UUID cursors', () => {
    const cursor = '10000000-0000-4000-8000-000000000001';
    expect(cursorPage(cursor, 500)).toEqual({ cursor, take: 100 });
    expect(cursorPage(undefined, 0)).toEqual({ cursor: undefined, take: 50 });
    expect(cursorPage(undefined, -10)).toEqual({ cursor: undefined, take: 1 });
  });

  it.each(['not-a-uuid', '1 OR 1=1', ['uuid']])('rejects malformed cursors: %s', (cursor) => {
    expect(() => cursorPage(cursor, 50)).toThrow('分页游标无效');
  });
});
