import { CircuitBreakerError } from '../../domain/errors';
import { logger } from '../../utils/logger';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  recoveryTimeoutMs?: number;
  name?: string;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private halfOpenProbeInFlight: boolean = false;
  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  public readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? 15000;
    this.name = options.name ?? 'default-circuit';
  }

  public getState(): CircuitState {
    if (this.state === CircuitState.OPEN) {
      const now = Date.now();
      if (now - this.lastFailureTime > this.recoveryTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
        this.halfOpenProbeInFlight = false;
        logger.info('CIRCUIT_BREAKER', `[${this.name}] Transitioned from OPEN to HALF_OPEN`);
      }
    }
    return this.state;
  }

  public async execute<T>(fn: () => Promise<T>, fallback?: () => Promise<T> | T): Promise<T> {
    const currentState = this.getState();

    if (currentState === CircuitState.OPEN) {
      logger.warn('CIRCUIT_BREAKER', `[${this.name}] Circuit is OPEN, rejecting execution.`);
      if (fallback) {
        return fallback();
      }
      throw new CircuitBreakerError(`[${this.name}] Circuit is OPEN. Operation short-circuited to protect downstream service.`);
    }

    if (currentState === CircuitState.HALF_OPEN) {
      if (this.halfOpenProbeInFlight) {
        logger.warn('CIRCUIT_BREAKER', `[${this.name}] Circuit HALF_OPEN probe already in flight, rejecting concurrent probe.`);
        if (fallback) {
          return fallback();
        }
        throw new CircuitBreakerError(`[${this.name}] Circuit HALF_OPEN probe already in flight. Concurrent execution rejected.`);
      }
      this.halfOpenProbeInFlight = true;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      if (fallback) {
        logger.info('CIRCUIT_BREAKER', `[${this.name}] Invoking fallback strategy.`);
        return fallback();
      }
      throw error;
    } finally {
      if (currentState === CircuitState.HALF_OPEN) {
        this.halfOpenProbeInFlight = false;
      }
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= 2) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        logger.info('CIRCUIT_BREAKER', `[${this.name}] Circuit successfully recovered to CLOSED`);
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(err?: any): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    logger.warn('CIRCUIT_BREAKER', `[${this.name}] Failure recorded (${this.failureCount}/${this.failureThreshold}): ${err?.message || err}`);
    if (this.state === CircuitState.HALF_OPEN || this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.successCount = 0;
      logger.error('CIRCUIT_BREAKER', `[${this.name}] Circuit OPENED due to consecutive threshold breaches.`);
    }
  }

  public reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }

  public getMetrics() {
    return {
      name: this.name,
      state: this.getState(),
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime
    };
  }
}

export const geminiCircuitBreaker = new CircuitBreaker({
  name: 'Gemini-GenAI-API',
  failureThreshold: 3,
  recoveryTimeoutMs: 15000
});

export const indexingCircuitBreaker = new CircuitBreaker({
  name: 'SearchEngine-Indexing-API',
  failureThreshold: 5,
  recoveryTimeoutMs: 30000
});
