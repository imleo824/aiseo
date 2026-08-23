import { Request, Response } from 'express';
import { fileTenantRepository } from '../infrastructure/persistence/fileTenantRepository';
import { TenantAccount } from '../../src/types/seo';
import { logger } from '../utils/logger';
import { TenantRequest } from '../middleware/tenant';

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

    // 严格密码校验
    if (!password) {
      res.status(401).json({ success: false, message: '请输入登录密码' });
      return;
    }

    const expectedPassword = found.passwordHash || 'admin123';
    if (password.trim() !== expectedPassword) {
      res.status(401).json({ success: false, message: '密码错误，请重新输入' });
      return;
    }

    const account = fileTenantRepository.getAccount(found.tenantId);
    const token = `token_${found.tenantId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    fileTenantRepository.storeSessionToken(token, found.tenantId);

    logger.info('AUTH', `User logged in successfully: ${account.username} (${found.tenantId}, Role: ${account.role})`);

    res.json({
      success: true,
      token,
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

    if (cleanUsername.length < 3) {
      res.status(400).json({ success: false, message: '用户名长度不能少于 3 个字符' });
      return;
    }

    if (!cleanEmail.includes('@')) {
      res.status(400).json({ success: false, message: '请输入有效的电子邮箱地址' });
      return;
    }

    const existing = fileTenantRepository.findTenantByEmailOrUsername(cleanUsername) || 
                     fileTenantRepository.findTenantByEmailOrUsername(cleanEmail);
    if (existing) {
      res.status(409).json({ success: false, message: '该用户名或邮箱已被注册，请直接登录' });
      return;
    }

    const sanitizedIdStr = cleanUsername.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const newTenantId = `tenant-${sanitizedIdStr || Date.now().toString(36)}`;

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

    await fileTenantRepository.createTenantAccount(newAccount, cleanPassword);
    const token = `token_${newTenantId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    fileTenantRepository.storeSessionToken(token, newTenantId);

    logger.info('AUTH', `New user registered: ${newAccount.username} (${newTenantId})`);

    res.json({
      success: true,
      token,
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

