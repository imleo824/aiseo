// This module must be loaded before Express. Sentry instruments Express at
// module-load time, so initializing it in app.ts is too late once express has
// already been imported by the entrypoint.
import * as Sentry from '@sentry/node';
import { env } from './env';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: env.runtime,
    release: process.env.RAILWAY_GIT_COMMIT_SHA,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    sendDefaultPii: false
  });
}
