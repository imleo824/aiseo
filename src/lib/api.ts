import { getSupabaseBrowserClient } from './supabase';

type ApiEnvelope<T> = { data: T; meta?: { nextCursor?: string; traceId?: string } };
type ApiErrorEnvelope = { error?: { code?: string; message?: string; details?: unknown; traceId?: string } };
const API_TIMEOUT_MS = 20_000;
const pendingWriteKeys = new Map<string, string>();

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public traceId?: string) {
    super(message);
  }
}

const isWriteRequest = (method?: string): boolean => Boolean(method && !['GET', 'HEAD'].includes(method.toUpperCase()));

export const writeRequestFingerprint = async (method: string, path: string, body: BodyInit | null | undefined): Promise<string> => {
  const bytes = new TextEncoder().encode(`${method.toUpperCase()}\n${path}\n${typeof body === 'string' ? body : ''}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const pendingWriteKey = async (method: string, path: string, body: BodyInit | null | undefined): Promise<{ fingerprint: string; key: string }> => {
  const fingerprint = await writeRequestFingerprint(method, path, body);
  const storageKey = `aiseo:pending-write:${fingerprint}`;
  let key = pendingWriteKeys.get(fingerprint);
  try {
    key ||= globalThis.sessionStorage?.getItem(storageKey) || undefined;
  } catch {
    // Some privacy modes deny sessionStorage; the in-memory key still protects
    // concurrent retries in the current page lifecycle.
  }
  key ||= crypto.randomUUID();
  pendingWriteKeys.set(fingerprint, key);
  try { globalThis.sessionStorage?.setItem(storageKey, key); } catch { /* see above */ }
  return { fingerprint, key };
};

const clearPendingWriteKey = (fingerprint: string): void => {
  pendingWriteKeys.delete(fingerprint);
  try { globalThis.sessionStorage?.removeItem(`aiseo:pending-write:${fingerprint}`); } catch { /* see above */ }
};

const request = async <T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> => {
  const supabase = getSupabaseBrowserClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new ApiError(401, 'UNAUTHORIZED', '登录会话已失效');
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${session.access_token}`);
  if (init.body) headers.set('content-type', 'application/json');
  let managedWriteFingerprint: string | undefined;
  if (isWriteRequest(init.method) && !headers.has('idempotency-key')) {
    const pending = await pendingWriteKey(init.method!, path, init.body);
    managedWriteFingerprint = pending.fingerprint;
    headers.set('idempotency-key', pending.key);
  }
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort('timeout'), API_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener('abort', abortFromCaller, { once: true });
  try {
    const response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'omit', signal: controller.signal });
    const payload = await response.json().catch(() => ({})) as ApiEnvelope<T> & ApiErrorEnvelope;
    if (!response.ok) {
      if (managedWriteFingerprint && response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status)) {
        clearPendingWriteKey(managedWriteFingerprint);
      }
      throw new ApiError(response.status, payload.error?.code || 'API_ERROR', payload.error?.message || '请求失败', payload.error?.details, payload.error?.traceId);
    }
    if (managedWriteFingerprint) clearPendingWriteKey(managedWriteFingerprint);
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted && !init.signal?.aborted) {
      throw new ApiError(0, 'REQUEST_TIMEOUT', '服务器响应超时，请稍后重试');
    }
    if (init.signal?.aborted) throw error;
    throw new ApiError(0, 'NETWORK_ERROR', '无法连接服务器，请检查网络后重试');
  } finally {
    globalThis.clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abortFromCaller);
  }
};

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
};
