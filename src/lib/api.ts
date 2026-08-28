import { supabase } from './supabase';

type ApiEnvelope<T> = { data: T; meta?: { nextCursor?: string; traceId?: string } };
type ApiErrorEnvelope = { error?: { code?: string; message?: string; details?: unknown; traceId?: string } };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public traceId?: string) {
    super(message);
  }
}

const request = async <T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new ApiError(401, 'UNAUTHORIZED', '登录会话已失效');
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${session.access_token}`);
  if (init.body) headers.set('content-type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method) && !headers.has('idempotency-key')) headers.set('idempotency-key', crypto.randomUUID());
  const response = await fetch(`/api${path}`, { ...init, headers, credentials: 'omit' });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T> & ApiErrorEnvelope;
  if (!response.ok) throw new ApiError(response.status, payload.error?.code || 'API_ERROR', payload.error?.message || '请求失败', payload.error?.details, payload.error?.traceId);
  return payload;
};

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
};
