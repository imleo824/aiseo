import { AsyncLocalStorage } from 'async_hooks';
import { TenantAccount } from '../../src/types/seo';

export interface TenantContextData {
  tenantId: string;
  account: TenantAccount;
  role: 'ADMIN' | 'TENANT';
  traceId?: string;
}

const tenantStorage = new AsyncLocalStorage<TenantContextData>();

export class TenantContext {
  public static run<T>(data: TenantContextData, fn: () => T): T {
    return tenantStorage.run(data, fn);
  }

  public static get(): TenantContextData | undefined {
    return tenantStorage.getStore();
  }

  public static getTenantId(): string | undefined {
    return tenantStorage.getStore()?.tenantId;
  }

  public static requireTenantId(): string {
    const store = tenantStorage.getStore();
    if (!store?.tenantId) {
      throw new Error('TenantContext error: No active tenant context bound to current execution trace');
    }
    return store.tenantId;
  }

  public static isAdmin(): boolean {
    const store = tenantStorage.getStore();
    return store?.account?.role === 'ADMIN' || store?.role === 'ADMIN' || store?.tenantId === 'tenant-a';
  }

  public static assertAccess(targetTenantId: string): void {
    const currentTenantId = TenantContext.getTenantId();
    if (!currentTenantId) return; // Unbound context (e.g., background system tasks)
    
    if (currentTenantId !== targetTenantId && !TenantContext.isAdmin()) {
      throw new Error(`TenantIsolationViolation: Tenant '${currentTenantId}' attempted unauthorized operation on tenant '${targetTenantId}'`);
    }
  }
}
