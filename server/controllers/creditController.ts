import { Request, Response } from 'express';
import { fileTenantRepository, DEFAULT_PRICING_CONFIG } from '../infrastructure/persistence/fileTenantRepository';
import { UsdtNetwork, PricingConfig } from '../../src/types/seo';
import { logger } from '../utils/logger';
import { TenantRequest } from '../middleware/tenant';

const ensureTenantResolved = (req: Request): void => {
  const tenantReq = req as TenantRequest;
  if (!tenantReq.account) {
    const authHeader = req.headers['authorization'] as string;
    const cookieToken = req.headers.cookie?.match(/(?:^|;\s*)seo_session=([^;]+)/)?.[1];
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : cookieToken;
    const session = fileTenantRepository.resolveTenantFromToken(token);
    if (session) {
      tenantReq.tenantId = session.tenantId;
      tenantReq.account = session.account;
      tenantReq.tenantData = session.tenantData;
    }
  }
};

export const creditController = {
  /**
   * 获取充值配置信息（套餐、收款钱包地址、汇率说明、扣费标准）
   */
  getConfig: async (_req: Request, res: Response): Promise<void> => {
    const config = fileTenantRepository.getPricingConfig();
    const wallets = {
      TRC20: {
        network: 'TRC20 (Tron 波场网络 · 极速低 Gas)',
        address: config.trc20Address || 'TLv5R4q9k8YJ3Z2QxP8wK1M7n6VbC9XyZ1',
        qrCodePlaceholder: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${config.trc20Address || 'TLv5R4q9k8YJ3Z2QxP8wK1M7n6VbC9XyZ1'}`
      }
    };

    res.json({
      success: true,
      rate: config.rate || '1 USDT = 100 基础积分',
      trc20Address: config.trc20Address || 'TLv5R4q9k8YJ3Z2QxP8wK1M7n6VbC9XyZ1',
      packages: config.packages || DEFAULT_PRICING_CONFIG.packages,
      wallets,
      actionPricing: config.actionPricing || DEFAULT_PRICING_CONFIG.actionPricing
    });
  },

  /**
   * 管理员更新系统定价与套餐配置
   */
  updateConfig: async (req: Request, res: Response): Promise<void> => {
    ensureTenantResolved(req);
    const tenantReq = req as TenantRequest;
    if (tenantReq.account?.role !== 'ADMIN') {
      res.status(403).json({ 
        success: false, 
        message: '权限拒绝：价格与套餐仅系统管理员（ADMIN）有权配置与修改，租户无权操作。' 
      });
      return;
    }

    const { rate, trc20Address, actionPricing, packages } = req.body as Partial<PricingConfig>;

    const updated = await fileTenantRepository.savePricingConfig({
      rate: rate?.trim(),
      trc20Address: trc20Address?.trim(),
      actionPricing,
      packages
    });

    logger.info('ADMIN_PRICING', `Admin ${tenantReq.tenantId} updated pricing config`);

    res.json({
      success: true,
      message: '🎉 积分扣费标准与 USDT 充值套餐配置已成功更新生效！',
      config: updated
    });
  },

  /**
   * 管理员恢复默认定价与套餐配置
   */
  resetConfig: async (req: Request, res: Response): Promise<void> => {
    ensureTenantResolved(req);
    const tenantReq = req as TenantRequest;
    if (tenantReq.account?.role !== 'ADMIN') {
      res.status(403).json({ 
        success: false, 
        message: '权限拒绝：仅系统管理员（ADMIN）有权恢复系统默认定价与套餐配置。' 
      });
      return;
    }

    const reset = await fileTenantRepository.savePricingConfig(DEFAULT_PRICING_CONFIG);
    logger.info('ADMIN_PRICING', `Admin ${tenantReq.tenantId} reset pricing config to defaults`);

    res.json({
      success: true,
      message: '✅ 已成功恢复系统默认定价与充值套餐配置！',
      config: reset
    });
  },

  /**
   * 获取当前租户积分余额与简报
   */
  getBalance: async (req: Request, res: Response): Promise<void> => {
    ensureTenantResolved(req);
    const tenantReq = req as TenantRequest;
    const tenantId = tenantReq.tenantId;
    if (!tenantId) {
      res.status(401).json({ success: false, message: '未登录或身份凭证已失效' });
      return;
    }
    const account = fileTenantRepository.getAccount(tenantId);
    res.json({
      success: true,
      credits: account.credits,
      totalRechargedUsdt: account.totalRechargedUsdt || 0,
      totalConsumedCredits: account.totalConsumedCredits || 0,
      account
    });
  },

  /**
   * 获取积分变动明细（账单流水）
   */
  getTransactions: async (req: Request, res: Response): Promise<void> => {
    ensureTenantResolved(req);
    const tenantReq = req as TenantRequest;
    const tenantId = tenantReq.tenantId;
    if (!tenantId) {
      res.status(401).json({ success: false, message: '未登录或身份凭证已失效' });
      return;
    }
    const txs = fileTenantRepository.getCreditTransactions(tenantId);
    res.json({
      success: true,
      transactions: txs
    });
  },

  /**
   * 提交 USDT 充值兑换积分
   */
  recharge: async (req: Request, res: Response): Promise<void> => {
    ensureTenantResolved(req);
    const tenantReq = req as TenantRequest;
    const tenantId = tenantReq.tenantId;
    if (!tenantId) {
      res.status(401).json({ success: false, message: '未登录或身份凭证已失效' });
      return;
    }
    const { usdtAmount, txHash, network = 'TRC20', packageId } = req.body;

    const parsedUsdt = Number(usdtAmount);
    if (!Number.isFinite(parsedUsdt) || parsedUsdt <= 0 || parsedUsdt > 100000) {
      res.status(400).json({ success: false, message: '请输入有效且处于允许范围内的充值 USDT 金额' });
      return;
    }
    if (!txHash || typeof txHash !== 'string' || txHash.trim().length < 16) {
      res.status(400).json({ success: false, message: '必须提供有效交易哈希；充值将在链上核验后到账' });
      return;
    }

    const config = fileTenantRepository.getPricingConfig();
    const packages = config.packages || DEFAULT_PRICING_CONFIG.packages;
    const selectedPackage = packages.find(pkg => pkg.id === packageId && pkg.usdtAmount === parsedUsdt);
    const requestedCredits = selectedPackage ? selectedPackage.credits : Math.floor(parsedUsdt * 100);
    const transaction = await fileTenantRepository.createPendingRecharge(
      tenantId,
      parsedUsdt,
      requestedCredits,
      txHash.trim(),
      network as UsdtNetwork
    );

    // A submitted hash is not proof of payment. Crediting is intentionally limited to
    // the verified settlement flow until a chain-indexer is connected.
    res.status(202).json({
      success: true,
      message: '充值申请已提交，等待链上交易核验后入账。',
      transaction
    });
  },

  /**
   * 系统级付费管理：获取所有租户的充值记录
   */
  getAllTransactions: async (req: Request, res: Response): Promise<void> => {
    ensureTenantResolved(req);
    const tenantReq = req as TenantRequest;
    if (tenantReq.account?.role !== 'ADMIN') {
      res.status(403).json({ success: false, message: '权限拒绝：仅平台管理员（ADMIN）有权查看全局充值记录' });
      return;
    }
    const ids = fileTenantRepository.getAllTenantIds();
    const allTxs = ids.flatMap(id => fileTenantRepository.getCreditTransactions(id).map(tx => ({...tx, tenantId: id})));
    allTxs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ success: true, transactions: allTxs });
  },

  /**
   * 系统级消耗管理：获取所有租户的账单流水
   */
  getAllUsages: async (req: Request, res: Response): Promise<void> => {
    ensureTenantResolved(req);
    const tenantReq = req as TenantRequest;
    if (tenantReq.account?.role !== 'ADMIN') {
      res.status(403).json({ success: false, message: '权限拒绝：仅平台管理员（ADMIN）有权查看全局消耗账单' });
      return;
    }
    const ids = fileTenantRepository.getAllTenantIds();
    const allUsages = ids.flatMap(id => {
      const data = fileTenantRepository.getTenantData(id);
      return (data.usageLedger || []).map(u => ({ ...u, tenantId: id }));
    });
    allUsages.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    res.json({ success: true, usages: allUsages });
  },

  /**
   * 管理员对指定租户手动上下分
   */
  adjustCredits: async (req: Request, res: Response): Promise<void> => {
    ensureTenantResolved(req);
    const tenantReq = req as TenantRequest;
    if (tenantReq.account?.role !== 'ADMIN') {
      res.status(403).json({ success: false, message: '权限拒绝：仅系统管理员（ADMIN）有权进行手动上下分操作' });
      return;
    }

    const { targetTenantId, deltaCredits, reason } = req.body;
    const numDelta = Number(deltaCredits);
    if (!targetTenantId || isNaN(numDelta) || numDelta === 0) {
      res.status(400).json({ success: false, message: '参数无效：请输入有效的目标租户 ID 与变动积分数量' });
      return;
    }

    try {
      const result = await fileTenantRepository.adjustTenantCredits(
        targetTenantId,
        numDelta,
        reason || '手动调整',
        tenantReq.tenantId
      );
      res.json({
        success: true,
        message: `✅ 已成功对租户 ${targetTenantId} 完成${numDelta > 0 ? '上分 +' : '下扣 '}${Math.abs(numDelta)} 积分，最新余额: ${result.balance} 积分`,
        balance: result.balance,
        account: result.account,
        transaction: result.tx
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || '上下分操作失败' });
    }
  },

  /**
   * 管理员手动确认 USDT 付费到账状态
   */
  confirmPayment: async (req: Request, res: Response): Promise<void> => {
    ensureTenantResolved(req);
    const tenantReq = req as TenantRequest;
    if (tenantReq.account?.role !== 'ADMIN') {
      res.status(403).json({ success: false, message: '权限拒绝：仅系统管理员（ADMIN）有权确认付费状态' });
      return;
    }

    const { txId, status, targetTenantId = 'tenant-a' } = req.body;
    if (!txId || !['CONFIRMED', 'PENDING', 'REJECTED'].includes(status)) {
      res.status(400).json({ success: false, message: '参数无效：请提供有效的交易 ID 及状态 (CONFIRMED / PENDING / REJECTED)' });
      return;
    }

    try {
      const result = await fileTenantRepository.updatePaymentStatus(
        targetTenantId,
        txId,
        status,
        tenantReq.tenantId
      );
      res.json({
        success: true,
        message: `✅ 已成功将交易 ${txId} 状态更新为: ${status === 'CONFIRMED' ? '已确认到账' : status === 'REJECTED' ? '已拒绝/未到账' : '待核验'}`,
        transaction: result.tx
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || '确认状态更新失败' });
    }
  }
};
