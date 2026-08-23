export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogPayload {
  level: LogLevel;
  module: string;
  message: string;
  traceId?: string;
  tenantId?: string;
  durationMs?: number;
  data?: any;
  timestamp: string;
}

class StructuredLogger {
  private formatOutput(payload: LogPayload): void {
    const timeStr = payload.timestamp.split('T')[1].replace('Z', '');
    const prefix = `[${timeStr}] [${payload.level}] [${payload.module}]`;
    const trace = payload.traceId ? `(trace:${payload.traceId.slice(-6)})` : '';
    const duration = payload.durationMs !== undefined ? `+${payload.durationMs}ms` : '';

    if (payload.level === 'ERROR') {
      console.error(`${prefix} ${trace} ${payload.message} ${duration}`, payload.data ? payload.data : '');
    } else if (payload.level === 'WARN') {
      console.warn(`${prefix} ${trace} ${payload.message} ${duration}`, payload.data ? payload.data : '');
    } else {
      console.log(`${prefix} ${trace} ${payload.message} ${duration}`, payload.data ? payload.data : '');
    }
  }

  public info(module: string, message: string, meta?: { traceId?: string; tenantId?: string; durationMs?: number; data?: any }): void {
    this.formatOutput({
      level: 'INFO',
      module,
      message,
      traceId: meta?.traceId,
      tenantId: meta?.tenantId,
      durationMs: meta?.durationMs,
      data: meta?.data,
      timestamp: new Date().toISOString()
    });
  }

  public warn(module: string, message: string, meta?: { traceId?: string; tenantId?: string; durationMs?: number; data?: any }): void {
    this.formatOutput({
      level: 'WARN',
      module,
      message,
      traceId: meta?.traceId,
      tenantId: meta?.tenantId,
      durationMs: meta?.durationMs,
      data: meta?.data,
      timestamp: new Date().toISOString()
    });
  }

  public error(module: string, message: string, meta?: { traceId?: string; tenantId?: string; durationMs?: number; data?: any }): void {
    this.formatOutput({
      level: 'ERROR',
      module,
      message,
      traceId: meta?.traceId,
      tenantId: meta?.tenantId,
      durationMs: meta?.durationMs,
      data: meta?.data,
      timestamp: new Date().toISOString()
    });
  }

  public profile(module: string, operationName: string, metaOrTraceId?: string | { traceId?: string; tenantId?: string }) {
    const start = Date.now();
    const traceId = typeof metaOrTraceId === 'string' ? metaOrTraceId : metaOrTraceId?.traceId;
    const tenantId = typeof metaOrTraceId === 'object' ? metaOrTraceId?.tenantId : undefined;

    return {
      done: (message?: string, extraData?: any) => {
        const durationMs = Date.now() - start;
        this.info(module, message || `${operationName} completed`, {
          traceId,
          tenantId,
          durationMs,
          data: extraData
        });
        return durationMs;
      },
      fail: (err: any) => {
        const durationMs = Date.now() - start;
        this.error(module, `${operationName} failed after ${durationMs}ms: ${err?.message || err}`, {
          traceId,
          tenantId,
          durationMs,
          data: err
        });
        return durationMs;
      }
    };
  }
}

export const logger = new StructuredLogger();
