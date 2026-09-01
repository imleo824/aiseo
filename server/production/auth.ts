import { createClient, type User } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../domain/errors';
import { env } from './env';
import { withRequestScope } from './prisma';

declare global {
  namespace Express {
    interface Request {
      authUser?: User;
      accessToken?: string;
    }
  }
}

let authClient: ReturnType<typeof createClient> | undefined;

const getAuthClient = () => {
  if (!env.supabaseUrl || !env.supabasePublishableKey) {
    throw new Error('Supabase Auth is not configured');
  }
  authClient ??= createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  return authClient;
};

const bearerToken = (request: Request): string => {
  const match = request.header('authorization')?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new UnauthorizedError('需要有效的 Supabase Bearer 会话');
  return match[1];
};

export const authenticate = async (request: Request): Promise<User> => {
  const token = bearerToken(request);
  const { data, error } = await getAuthClient().auth.getUser(token);
  if (error || !data.user) throw new UnauthorizedError('会话无效、已过期或已撤销');
  if (!data.user.email_confirmed_at) throw new ForbiddenError('请先完成邮箱验证');
  request.authUser = data.user;
  request.accessToken = token;
  return data.user;
};

export const requireAuth = (request: Request, _response: Response, next: NextFunction): void => {
  void authenticate(request).then(() => next(), next);
};

// Sensitive operations deliberately perform another Auth server round-trip at
// execution time. This prevents a revoked session from passing based on stale
// request-local state or a cached profile lookup.
export const revalidateSensitiveSession = async (request: Request): Promise<User> => {
  request.authUser = undefined;
  const user = await authenticate(request);
  const payloadSegment = request.accessToken?.split('.')[1];
  let sessionId = '';
  try {
    const claims = JSON.parse(Buffer.from(payloadSegment || '', 'base64url').toString('utf8')) as { session_id?: unknown };
    sessionId = typeof claims.session_id === 'string' ? claims.session_id : '';
  } catch {
    throw new UnauthorizedError('会话声明无效');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) throw new UnauthorizedError('会话缺少有效 session_id');
  const rows = await withRequestScope({ profileId: user.id }, (tx) => tx.$queryRaw<Array<{ active: boolean }>>`
    SELECT private.is_active_auth_session(${sessionId}::uuid) AS active
  `);
  if (!rows[0]?.active) throw new UnauthorizedError('会话已撤销，请重新登录');
  return user;
};

export const eraseOwnAuthUser = async (accessToken: string): Promise<void> => {
  if (!env.supabaseUrl) throw new Error('Supabase Auth is not configured');
  const response = await fetch(`${env.supabaseUrl.replace(/\/$/, '')}/functions/v1/account-erasure`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Failed to erase Supabase Auth user: HTTP ${response.status}`);
};
