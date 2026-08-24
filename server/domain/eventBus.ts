import { EventEmitter } from 'events';

export type DomainEventType = 
  | 'SITE_CREATED'
  | 'SITE_UPDATED'
  | 'SITE_DELETED'
  | 'AUTOPILOT_TOGGLED'
  | 'OPPORTUNITY_DISCOVERED'
  | 'BRIEF_GENERATED'
  | 'ARTICLE_DRAFT_CREATED'
  | 'ARTICLE_PUBLISHED'
  | 'ARTICLE_ROLLED_BACK'
  | 'INDEX_NOW_PUSHED'
  | 'BAIDU_PUSHED'
  | 'QUALITY_GATE_PASSED'
  | 'QUALITY_GATE_FAILED'
  | 'TASK_SCHEDULED_RUN';

export interface DomainEvent<T = any> {
  id: string;
  type: DomainEventType;
  tenantId: string;
  siteId?: string;
  timestamp: string;
  payload: T;
  traceId?: string;
}

class DomainEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  public publish<T>(event: DomainEvent<T>): void {
    try {
      this.emit(event.type, event);
      this.emit('*', event);
    } catch (err) {
      console.error(`[EVENT_BUS] Sync error publishing event ${event.type}:`, err);
    }
  }

  public subscribe<T>(type: DomainEventType | '*', handler: (event: DomainEvent<T>) => void | Promise<void>): void {
    const safeHandler = async (event: DomainEvent<T>) => {
      try {
        await Promise.resolve(handler(event));
      } catch (err) {
        console.error(`[EVENT_BUS] Error handling domain event ${event.type} (${event.id}):`, err);
      }
    };
    // Attach underlying handler reference for unsubscribing
    (safeHandler as any)._originalHandler = handler;
    this.on(type, safeHandler);
  }

  public unsubscribe<T>(type: DomainEventType | '*', handler: (event: DomainEvent<T>) => void | Promise<void>): void {
    const listeners = this.listeners(type);
    for (const listener of listeners) {
      if ((listener as any)._originalHandler === handler || listener === handler) {
        this.off(type, listener as any);
      }
    }
  }
}

export const eventBus = new DomainEventBus();
