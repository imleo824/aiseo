import { randomUUID } from 'crypto';
import type { TransactionClient } from './prisma';

type RecordRow = Record<string, any>;

const demoProfileId = '00000000-0000-4000-8000-000000000001';
const demoOrgId = '11111111-1111-4111-8111-111111111111';
const demoSiteId = '22222222-2222-4222-8222-222222222222';

class InMemoryStore {
  private tables = new Map<string, RecordRow[]>();

  constructor() {
    this.seed();
  }

  private seed() {
    this.tables.set('profile', [{
      id: demoProfileId,
      email: 'demo@aiseo.ai',
      displayName: 'Demo Admin',
      platformRole: 'PLATFORM_ADMIN',
      createdAt: new Date(),
      updatedAt: new Date()
    }]);

    this.tables.set('organization', [{
      id: demoOrgId,
      name: '我的增长工作区',
      creditBalanceMicros: 1000000000n,
      createdAt: new Date(),
      updatedAt: new Date()
    }]);

    this.tables.set('organizationMember', [{
      id: randomUUID(),
      organizationId: demoOrgId,
      profileId: demoProfileId,
      role: 'OWNER',
      createdAt: new Date(),
      updatedAt: new Date(),
      organization: {
        id: demoOrgId,
        name: '我的增长工作区',
        creditBalanceMicros: 1000000000n,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      profile: {
        id: demoProfileId,
        email: 'demo@aiseo.ai',
        displayName: 'Demo Admin'
      }
    }]);

    this.tables.set('site', [{
      id: demoSiteId,
      organizationId: demoOrgId,
      name: 'WordPress 演示站点',
      domain: 'https://example.com',
      language: 'zh-CN',
      niche: 'AI 营销与 SaaS',
      wordpressStatus: 'DISCONNECTED',
      wordpressUser: null,
      wordpressCompatibilityMode: 'RECHECK_REQUIRED',
      wordpressVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      integrations: []
    }]);

    this.tables.set('paymentPackage', [
      { id: 'pkg-1', name: '入门体验包', baseAmountMicros: 10000000n, creditMicros: 1000000000n, active: true, sortOrder: 1 },
      { id: 'pkg-2', name: '初创版 (Starter)', baseAmountMicros: 50000000n, creditMicros: 5500000000n, active: true, sortOrder: 2 },
      { id: 'pkg-3', name: '成长版 (Growth)', baseAmountMicros: 200000000n, creditMicros: 24000000000n, active: true, sortOrder: 3 },
      { id: 'pkg-4', name: '旗舰版 (Scale)', baseAmountMicros: 500000000n, creditMicros: 65000000000n, active: true, sortOrder: 4 }
    ]);

    this.tables.set('actionPrice', [
      { id: 'act-1', action: 'GROWTH_PIPELINE_RUN', creditMicros: 25000000n, active: true },
      { id: 'act-2', action: 'DISCOVER_OPPORTUNITY', creditMicros: 5000000n, active: true },
      { id: 'act-3', action: 'GENERATE_ARTICLE', creditMicros: 15000000n, active: true },
      { id: 'act-4', action: 'PUBLISH_WORDPRESS', creditMicros: 5000000n, active: true }
    ]);

    this.tables.set('systemSetting', [
      { key: 'publishing_confirmation_policy', value: { requireManualConfirmation: false } }
    ]);

    this.tables.set('workerHeartbeat', [
      { id: 'worker-1', heartbeatAt: new Date(), capabilities: { dataForSeo: true, contentAi: true, trc20Payments: true, gsc: true } }
    ]);

    this.tables.set('contentDraft', []);
    this.tables.set('growthProgram', []);
    this.tables.set('growthRun', []);
    this.tables.set('growthAction', []);
    this.tables.set('ledgerEntry', [{
      id: 'led-1',
      organizationId: demoOrgId,
      amountMicros: 1000000000n,
      balanceAfterMicros: 1000000000n,
      action: 'SYSTEM_INITIAL_GRANT',
      description: 'AI Studio 演示环境初始测试额度',
      createdAt: new Date()
    }]);
    this.tables.set('paymentIntent', []);
    this.tables.set('auditEvent', []);
    this.tables.set('opportunity', []);
    this.tables.set('siteSnapshot', []);
    this.tables.set('dataSnapshot', []);
    this.tables.set('measurementSample', []);
    this.tables.set('wordPressCompatibilityProfile', []);
    this.tables.set('knowledgeSource', []);
    this.tables.set('jobRun', []);
  }

  getTable(name: string): RecordRow[] {
    let rows = this.tables.get(name);
    if (!rows) {
      rows = [];
      this.tables.set(name, rows);
    }
    return rows;
  }

  createTableHandler(tableName: string) {
    const self = this;
    return {
      findMany: async (args?: any) => {
        const rows = self.getTable(tableName);
        let result = [...rows];
        if (args?.where) {
          result = result.filter((row) => self.matchWhere(row, args.where));
        }
        if (args?.take) {
          result = result.slice(0, args.take);
        }
        return result;
      },
      findFirst: async (args?: any) => {
        const rows = self.getTable(tableName);
        if (tableName === 'workerHeartbeat' && rows.length > 0) {
          rows[0].heartbeatAt = new Date();
        }
        if (!args?.where) return rows[0] || null;
        return rows.find((row) => self.matchWhere(row, args.where)) || null;
      },
      findUnique: async (args?: any) => {
        const rows = self.getTable(tableName);
        if (!args?.where) return rows[0] || null;
        return rows.find((row) => self.matchWhere(row, args.where)) || null;
      },
      findUniqueOrThrow: async (args?: any) => {
        const rows = self.getTable(tableName);
        const match = args?.where ? rows.find((row) => self.matchWhere(row, args.where)) : rows[0];
        if (!match) {
          if (tableName === 'profile') {
            return {
              id: args?.where?.id || demoProfileId,
              email: 'demo@aiseo.ai',
              displayName: 'Demo Admin',
              platformRole: 'PLATFORM_ADMIN',
              createdAt: new Date(),
              updatedAt: new Date()
            };
          }
          throw new Error(`Record not found in ${tableName}`);
        }
        return match;
      },
      create: async (args: any) => {
        const rows = self.getTable(tableName);
        const newRecord = {
          id: args?.data?.id || randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...args?.data
        };
        rows.push(newRecord);
        return newRecord;
      },
      update: async (args: any) => {
        const rows = self.getTable(tableName);
        const index = args?.where ? rows.findIndex((row) => self.matchWhere(row, args.where)) : -1;
        const cleanData = Object.fromEntries(Object.entries(args?.data || {}).filter(([, val]) => val !== undefined));
        if (index === -1) {
          const created = { id: args?.where?.id || randomUUID(), ...cleanData, updatedAt: new Date() };
          rows.push(created);
          return created;
        }
        rows[index] = { ...rows[index], ...cleanData, updatedAt: new Date() };
        return rows[index];
      },
      upsert: async (args: any) => {
        const rows = self.getTable(tableName);
        const index = args?.where ? rows.findIndex((row) => self.matchWhere(row, args.where)) : -1;
        if (index === -1) {
          const cleanCreate = Object.fromEntries(Object.entries(args?.create || {}).filter(([, val]) => val !== undefined));
          const created = { id: `id-${Date.now()}`, ...cleanCreate, createdAt: new Date(), updatedAt: new Date() };
          rows.push(created);
          return created;
        }
        const cleanUpdate = Object.fromEntries(Object.entries(args?.update || {}).filter(([, val]) => val !== undefined));
        rows[index] = { ...rows[index], ...cleanUpdate, updatedAt: new Date() };
        return rows[index];
      },
      delete: async (args: any) => {
        const rows = self.getTable(tableName);
        const index = args?.where ? rows.findIndex((row) => self.matchWhere(row, args.where)) : -1;
        if (index !== -1) {
          const [removed] = rows.splice(index, 1);
          return removed;
        }
        return {};
      },
      count: async (args?: any) => {
        const rows = self.getTable(tableName);
        if (!args?.where) return rows.length;
        return rows.filter((row) => self.matchWhere(row, args.where)).length;
      }
    };
  }

  private matchWhere(row: RecordRow, where: RecordRow): boolean {
    for (const [key, val] of Object.entries(where)) {
      if (val === undefined) continue;
      if (typeof val === 'object' && val !== null) {
        if ('in' in val && Array.isArray(val.in)) {
          if (!val.in.includes(row[key])) return false;
        } else if ('equals' in val) {
          if (row[key] !== val.equals) return false;
        }
      } else {
        if (row[key] !== val) return false;
      }
    }
    return true;
  }
}

const memoryStore = new InMemoryStore();

export const createMockTransactionClient = (): TransactionClient => {
  const handler: ProxyHandler<object> = {
    get(_target, prop: string) {
      if (prop === '$executeRaw' || prop === '$executeRawUnsafe') {
        return async () => 1;
      }
      if (prop === '$queryRaw' || prop === '$queryRawUnsafe') {
        return async () => [];
      }
      return memoryStore.createTableHandler(prop);
    }
  };
  return new Proxy({}, handler) as unknown as TransactionClient;
};

export const mockDatabaseScope = async <T>(
  _identity: { organizationId?: string; profileId: string },
  operation: (tx: TransactionClient) => Promise<T>
): Promise<T> => {
  const tx = createMockTransactionClient();
  return operation(tx);
};
