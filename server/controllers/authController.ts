import { Request, Response } from 'express';
import { fileTenantRepository } from '../infrastructure/persistence/fileTenantRepository';
import { TenantAccount } from '../../src/types/seo';
import { logger } from '../utils/logger';
import { TenantRequest } from '../middleware/tenant';
import { createSessionToken, hashPassword, isPasswordHash, verifyPassword } from '../utils/auth';
import { randomUUID } from 'crypto';

const INSECURE_DEMO_PASSWORDS = new Set(['admin123', 'password123']);

const setSessionCookie = (res: Response, token: string) => {
  res.cookie('seo_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/'
  });
};

export const authController = {
  /**
   * 登录接口：支持用户名或邮箱 + 密码验证
   */
  login: async (req: Request, res: Response): Promise<void> => {
    const { usernameOrEmail, password } = req.body;
    if (!usernameOrEmail || !usernameOrEmail.trim()) {
      res.status(400).json({ success: false, message: '请输入用户名或邮箱' });
      return;
    }

    const cleanInput = usernameOrEmail.trim();
    const found = fileTenantRepository.findTenantByEmailOrUsername(cleanInput);
    if (!found) {
      res.status(401).json({ success: false, message: '账号不存在，请检查或先注册新账号' });
      return;
    }

    if (!password) {
      res.status(401).json({ success: false, message: '请输入登录密码' });
      return;
    }

    const suppliedPassword = password.trim();
    const storedCredential = found.passwordHash;
    if (!storedCredential || INSECURE_DEMO_PASSWORDS.has(storedCredential)) {
      res.status(403).json({
        success: false,
        message: '该账号仍使用已禁用的演示凭据。请通过管理员密码重置流程设置新密码。'
      });
      return;
    }

    const validPassword = isPasswordHash(storedCredential)
      ? await verifyPassword(suppliedPassword, storedCredential)
      : suppliedPassword === storedCredential;
    if (!validPassword) {
      res.status(401).json({ success: false, message: '密码错误，请重新输入' });
      return;
    }

    // Legacy plaintext values are upgraded only after successful verification.
    if (!isPasswordHash(storedCredential)) {
      await fileTenantRepository.updatePasswordHash(found.tenantId, await hashPassword(suppliedPassword));
    }

    const account = fileTenantRepository.getAccount(found.tenantId);
    const token = createSessionToken();
    fileTenantRepository.storeSessionToken(token, found.tenantId);
    setSessionCookie(res, token);

    logger.info('AUTH', `User logged in successfully: ${account.username} (${found.tenantId}, Role: ${account.role})`);

    res.json({
      success: true,
      tenantId: found.tenantId,
      account
    });
  },

  /**
   * 注册新租户账号
   */
  register: async (req: Request, res: Response): Promise<void> => {
    const { username, email, password, companyName } = req.body;
    if (!username || !email || !password) {
      res.status(400).json({ success: false, message: '用户名、邮箱和密码均为必填项' });
      return;
    }

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (cleanUsername.length < 3 || cleanUsername.length > 64) {
      res.status(400).json({ success: false, message: '用户名长度必须在 3 到 64 个字符之间' });
      return;
    }

    if (!cleanEmail.includes('@')) {
      res.status(400).json({ success: false, message: '请输入有效的电子邮箱地址' });
      return;
    }
    if (cleanPassword.length < 12) {
      res.status(400).json({ success: false, message: '密码长度不能少于 12 个字符' });
      return;
    }

    const existing = fileTenantRepository.findTenantByEmailOrUsername(cleanUsername) || 
                     fileTenantRepository.findTenantByEmailOrUsername(cleanEmail);
    if (existing) {
      res.status(409).json({ success: false, message: '该用户名或邮箱已被注册，请直接登录' });
      return;
    }

    const newTenantId = `tenant-${randomUUID()}`;

    const newAccount: TenantAccount = {
      id: newTenantId,
      username: cleanUsername,
      email: cleanEmail,
      companyName: companyName ? companyName.trim() : `${cleanUsername} 的 SEO 矩阵`,
      credits: 100, // 注册即赠送 100 积分
      totalRechargedUsdt: 0,
      totalConsumedCredits: 0,
      role: 'TENANT',
      createdAt: new Date().toISOString()
    };

    await fileTenantRepository.createTenantAccount(newAccount, await hashPassword(cleanPassword));
    const token = createSessionToken();
    fileTenantRepository.storeSessionToken(token, newTenantId);
    setSessionCookie(res, token);

    logger.info('AUTH', `New user registered: ${newAccount.username} (${newTenantId})`);

    res.json({
      success: true,
      tenantId: newTenantId,
      account: newAccount
    });
  },

  /**
   * 获取当前已登录账号的详细凭证信息
   */
  getMe: async (req: Request, res: Response): Promise<void> => {
    const tenantReq = req as TenantRequest;
    if (!tenantReq.tenantId || !tenantReq.account) {
      res.status(401).json({ success: false, message: '未登录或身份凭证已失效' });
      return;
    }

    res.json({
      success: true,
      tenantId: tenantReq.tenantId,
      account: tenantReq.account
    });
  },

  logout: async (req: Request, res: Response): Promise<void> => {
    const authHeader = req.headers['authorization'] as string | undefined;
    const cookieToken = req.headers.cookie?.match(/(?:^|;\s*)seo_session=([^;]+)/)?.[1];
    const token = authHeader?.replace(/^Bearer\s+/i, '') || cookieToken;
    fileTenantRepository.revokeSessionToken(token);
    res.clearCookie('seo_session', { httpOnly: true, sameSite: 'lax', path: '/' });
    res.status(204).send();
  },

  /**
   * 系统租户账号列表（仅平台管理员 ADMIN 有权调取）
   */
  listTenants: async (req: Request, res: Response): Promise<void> => {
    const tenantReq = req as TenantRequest;
    if (tenantReq.account?.role !== 'ADMIN') {
      res.status(403).json({
        success: false,
        message: '权限拒绝：仅平台管理员（ADMIN）有权查看租户列表'
      });
      return;
    }

    const ids = fileTenantRepository.getAllTenantIds();
    const accounts = ids.map(id => fileTenantRepository.getAccount(id));
    res.json({
      success: true,
      tenants: accounts
    });
  }
};
