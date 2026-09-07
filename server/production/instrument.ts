// This module must be loaded before Express. Sentry instruments Express at
// module-load time, so initializing it in app.ts is too late once express has
// already been imported by the entrypoint.
import * as Sentry from '@sentry/node';
import { env } from './env';

type TelemetryEventWithRequest = {
  request?: {
    url?: string;
    query_string?: unknown;
    data?: unknown;
    cookies?: unknown;
  };
};

export const stripSensitiveRequestData = <T extends TelemetryEventWithRequest>(event: T): T => {
  if (!event.request) return event;
  // WordPress Application Password authorization returns credentials in the
  // callback query string by protocol design. Never send query strings,
  // request bodies or cookies to telemetry, even when an OAuth callback fails.
  if (event.request.url) event.request.url = event.request.url.split('?')[0];
  event.request.query_string = undefined;
  event.request.data = undefined;
  event.request.cookies = undefined;
  return event;
};

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: env.runtime,
    release: process.env.RAILWAY_GIT_COMMIT_SHA,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    sendDefaultPii: false,
    beforeSend: stripSensitiveRequestData,
    beforeSendTransaction: stripSensitiveRequestData
  });
}
