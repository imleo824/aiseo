import { createClient, type User } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../domain/errors';
import { env } from './env';

declare global {
  namespace Express {
    interface Request {
      authUser?: User;
      accessToken?: string;
    }
  }
}

let authClient: ReturnType<typeof createClient> | undefined;
let adminClient: ReturnType<typeof createClient> | undefined;

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
  return authenticate(request);
};

export const revokeAllSessions = async (accessToken: string): Promise<void> => {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) throw new Error('Supabase service role is required for global session revocation');
  adminClient ??= createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await adminClient.auth.admin.signOut(accessToken, 'global');
  if (error) throw new Error(`Failed to revoke Supabase sessions: ${error.message}`);
};

export const deleteAuthUser = async (profileId: string): Promise<void> => {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) throw new Error('Supabase service role is required for account erasure');
  adminClient ??= createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await adminClient.auth.admin.deleteUser(profileId, false);
  if (error) throw new Error(`Failed to delete Supabase Auth user: ${error.message}`);
};
