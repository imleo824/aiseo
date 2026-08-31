import { logger } from '../utils/logger';

export type ProductionServiceKind = 'web' | 'worker';

export const resolveProductionServiceKind = (value: string | undefined): ProductionServiceKind => {
  const normalized = value?.trim().toLocaleLowerCase();
  if (normalized === 'web' || normalized === 'worker') return normalized;
  throw new Error('SERVICE_KIND must be explicitly set to web or worker');
};

const start = async (): Promise<void> => {
  const service = resolveProductionServiceKind(process.env.SERVICE_KIND);
  if (service === 'worker') {
    const { startProductionWorker } = await import('./worker');
    await startProductionWorker();
    return;
  }
  const { startProductionWeb } = await import('./server');
  await startProductionWeb();
};

if (process.argv[1]?.endsWith('entrypoint.ts') || process.argv[1]?.endsWith('entrypoint.cjs')) {
  void start().catch((error) => {
    logger.error('SERVICE_BOOT', 'Failed to start configured production service', { data: error });
    process.exit(1);
  });
}
