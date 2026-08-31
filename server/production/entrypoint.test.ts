import { describe, expect, it } from 'vitest';
import { resolveProductionServiceKind } from './entrypoint';

describe('production service entrypoint', () => {
  it('selects the Web and Worker processes explicitly', () => {
    expect(resolveProductionServiceKind('web')).toBe('web');
    expect(resolveProductionServiceKind('worker')).toBe('worker');
    expect(resolveProductionServiceKind(' WORKER ')).toBe('worker');
  });

  it('fails closed when the service identity is absent or invalid', () => {
    expect(() => resolveProductionServiceKind(undefined)).toThrow('SERVICE_KIND');
    expect(() => resolveProductionServiceKind('')).toThrow('SERVICE_KIND');
    expect(() => resolveProductionServiceKind('api')).toThrow('SERVICE_KIND');
  });
});
