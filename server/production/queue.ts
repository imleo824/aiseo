import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { env } from './env';

export const PRODUCTION_QUEUE = 'aiseo-production';

let connection: IORedis | undefined;
let queue: Queue | undefined;

export const getQueueConnection = (): IORedis => {
  if (!env.redisUrl) throw new Error('REDIS_URL is required before creating asynchronous jobs');
  if (!connection) connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false, lazyConnect: true });
  return connection;
};

export const getProductionQueue = (): Queue => {
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
