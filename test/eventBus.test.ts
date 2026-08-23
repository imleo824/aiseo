import { describe, it, expect, vi } from 'vitest';
import { eventBus, DomainEvent } from '../server/domain/eventBus';

describe('DomainEventBus', () => {
  it('should dispatch specific event to subscribers', async () => {
    const handler = vi.fn();
    eventBus.subscribe('SITE_CREATED', handler);

    const event: DomainEvent = {
      id: 'evt-1',
      type: 'SITE_CREATED',
      tenantId: 'tenant-test',
      siteId: 'site-1',
      timestamp: new Date().toISOString(),
      payload: { domain: 'test.com' }
    };

    eventBus.publish(event);
    expect(handler).toHaveBeenCalledWith(event);
    eventBus.unsubscribe('SITE_CREATED', handler);
  });

  it('should dispatch wildcard event to catch-all subscribers', async () => {
    const wildcardHandler = vi.fn();
    eventBus.subscribe('*', wildcardHandler);

    const event: DomainEvent = {
      id: 'evt-2',
      type: 'ARTICLE_PUBLISHED',
      tenantId: 'tenant-test',
      timestamp: new Date().toISOString(),
      payload: { draftId: 'draft-10' }
    };

    eventBus.publish(event);
    expect(wildcardHandler).toHaveBeenCalledWith(event);
    eventBus.unsubscribe('*', wildcardHandler);
  });
});
