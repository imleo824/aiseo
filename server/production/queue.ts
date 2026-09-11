import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { env } from './env';

export const PRODUCTION_QUEUE = 'aiseo-production';

let connection: IORedis | undefined;
let queue: Queue | undefined;

// In-memory mock when REDIS_URL is not configured
const store = new Map<string, { val: unknown; expiresAt?: number }>();
const mockRedis = {
  ping: async () => 'PONG',
  get: async (k: string) => {
    const item = store.get(k);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      store.delete(k);
      return null;
    }
    return item.val ?? null;
  },
  set: async (k: string, v: unknown) => {
    store.set(k, { val: v });
    return 'OK';
  },
  del: async (k: string) => {
    store.delete(k);
    return 1;
  },
  incr: async (k: string) => {
    const item = store.get(k);
    const n = Number(item?.val || 0) + 1;
    store.set(k, { val: n, expiresAt: item?.expiresAt });
    return n;
  },
  pexpire: async (k: string, ms: number) => {
    const item = store.get(k);
    if (item) item.expiresAt = Date.now() + ms;
    return 1;
  },
  pttl: async (k: string) => {
    const item = store.get(k);
    if (!item || !item.expiresAt) return -1;
    return Math.max(0, item.expiresAt - Date.now());
  },
  multi: () => {
    const ops: Array<() => Promise<[Error | null, any]>> = [];
    const chain = {
      incr: (k: string) => {
        ops.push(async () => {
          const n = await mockRedis.incr(k);
          return [null, n];
        });
        return chain;
      },
      pttl: (k: string) => {
        ops.push(async () => {
          const ttl = await mockRedis.pttl(k);
          return [null, ttl];
        });
        return chain;
      },
      exec: async () => {
        const results = [];
        for (const op of ops) {
          results.push(await op());
        }
        return results;
      }
    };
    return chain;
  },
  quit: async () => {},
  disconnect: () => {},
  on: () => mockRedis,
} as unknown as IORedis;

const mockQueue = {
  add: async (_name: string, _data: unknown, options?: JobsOptions) => ({ id: options?.jobId || 'mock-job-id' }),
  upsertJobScheduler: async (id: string) => ({ id }),
  close: async () => {},
} as unknown as Queue;

// A configured local Redis is still a real queue. Treating it as an in-memory
// mock makes the Worker behave differently in CI and prevents BullMQ's
// scheduler from running. The mock is reserved strictly for configurations
// without Redis at all.
const hasRealRedis = Boolean(env.redisUrl);

export const getQueueConnection = (): IORedis => {
  if (!hasRealRedis) return mockRedis;
  if (!connection) connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false, lazyConnect: true });
  return connection;
};

export const getProductionQueue = (): Queue => {
  if (!hasRealRedis) return mockQueue;
  if (!queue) queue = new Queue(PRODUCTION_QUEUE, { connection: getQueueConnection(), defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2_000 }, removeOnComplete: 500, removeOnFail: 2_000 } });
  return queue;
};

export const productionJobOptions = (jobId: string, options: JobsOptions = {}): JobsOptions => ({ jobId, ...options });

export const closeQueue = async (): Promise<void> => {
  await queue?.close();
  await connection?.quit();
  queue = undefined;
  connection = undefined;
};
