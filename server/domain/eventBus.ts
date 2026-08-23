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
  public publish<T>(event: DomainEvent<T>): void {
    this.emit(event.type, event);
    this.emit('*', event);
  }

  public subscribe<T>(type: DomainEventType | '*', handler: (event: DomainEvent<T>) => void | Promise<void>): void {
    this.on(type, handler);
  }

  public unsubscribe<T>(type: DomainEventType | '*', handler: (event: DomainEvent<T>) => void | Promise<void>): void {
    this.off(type, handler);
  }
}

export const eventBus = new DomainEventBus();
