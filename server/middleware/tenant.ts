import { Request, Response, NextFunction } from "express";
import { fileTenantRepository } from "../infrastructure/persistence/fileTenantRepository";
import { TenantData } from "../domain/repository";
import { TenantAccount } from "../../src/types/seo";
import { TenantContext } from "../utils/tenantContext";

export interface TenantRequest extends Request {
  tenantId: string;
  tenantData: TenantData;
  account: TenantAccount;
}

const getSessionCookie = (cookieHeader?: string): string | undefined =>
  cookieHeader?.match(/(?:^|;\s*)seo_session=([^;]+)/)?.[1];

// 开放无需强登录鉴权的公开 API 路径
const UNPROTECTED_PATHS = [
  '/api/health',
  '/api/auth/login',
  '/api/auth/register'
];

export const tenantMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (!req.path.startsWith('/api/')) {
    return next();
  }
  if (req.path.startsWith('/api/v1')) {
    return next();
  }

  // 公开身份验证与配置等路由免强校验
  if (UNPROTECTED_PATHS.includes(req.path)) {
    return next();
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : getSessionCookie(req.headers.cookie);
  const session = fileTenantRepository.resolveTenantFromToken(token);

  // 公开查看套餐等 GET 接口可缺省降级，其它涉及数据的业务接口进行强身份校验
  if (!session) {
    res.status(401).json({
      success: false,
      message: '身份凭证失效或未登录，请先登录账号',
      requiresAuth: true
    });
    return;
  }

  const tenantRequest = req as TenantRequest;
  tenantRequest.tenantId = session.tenantId;
  tenantRequest.account = session.account;
  tenantRequest.tenantData = session.tenantData;
  
  TenantContext.run(
    {
      tenantId: session.tenantId,
      account: session.account,
      role: session.account?.role || 'TENANT'
    },
    () => next()
  );
};
