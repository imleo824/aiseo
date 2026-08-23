import * as fs from 'fs';
import * as path from 'path';
import { PricingConfig, ActionPricingItem, CreditActionType } from '../../../src/types/seo';
import { logger } from '../../utils/logger';

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  rate: '1 USDT = 100 基础积分',
  trc20Address: 'TLv5R4q9k8YJ3Z2QxP8wK1M7n6VbC9XyZ1',
  actionPricing: [
    { 
      action: 'CRUISE_PIPELINE', 
      name: '一键全流程发文', 
      credits: 20, 
      desc: '选题挖掘、深度长文创作、质量门禁、WordPress发布与全网秒级收录推送',
      enabled: true 
    },
    { 
      action: 'AUTOPILOT_CRUISE', 
      name: '自动执行定时巡航发文', 
      credits: 20, 
      desc: '周期性无人值守托管自动生成与同步发布',
      enabled: true 
    },
    { 
      action: 'COMPETITOR_ANALYSIS', 
      name: '竞品攻击与流量穿透分析', 
      credits: 15, 
      desc: '全网逆向解构竞品关键词、流量盲区与截流策略',
      enabled: true 
    },
    { 
      action: 'DRAFT_GENERATE', 
      name: 'AI 文章单独生成', 
      credits: 10, 
      desc: '3000+ 字 SEO 深度长文与结构化排版创作',
      enabled: true 
    },
    { 
      action: 'SITE_AUDIT', 
      name: '站点添加与深度连接体检', 
      credits: 5, 
      desc: 'REST API 结构化探测、连通性测试与环境诊断',
      enabled: true 
    }
  ],
  packages: [
    {
      id: 'pkg-10',
      name: '基础体验包',
      badge: '入门推荐',
      usdtAmount: 10,
      credits: 1000,
      bonusCredits: 0
    },
    {
      id: 'pkg-50',
      name: '专业进阶包',
      badge: '最受欢迎 (+10% 赠送)',
      usdtAmount: 50,
      credits: 5500,
      bonusCredits: 500,
      popular: true
    },
    {
      id: 'pkg-100',
      name: '企业旗舰包',
      badge: '超值加赠 (+20% 赠送)',
      usdtAmount: 100,
      credits: 12000,
      bonusCredits: 2000
    },
    {
      id: 'pkg-300',
      name: '霸屏尊享包',
      badge: '大宗特惠 (+33% 赠送)',
      usdtAmount: 300,
      credits: 40000,
      bonusCredits: 10000
    }
  ]
};

export class PricingConfigRepository {
  private configPath = path.join(process.cwd(), 'system_pricing_config.json');
  private tmpConfigPath = path.join(process.cwd(), 'system_pricing_config.json.tmp');
  private systemPricingConfig: PricingConfig = JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG));
  private isLoaded = false;

  constructor() {
    this.loadFromFile();
  }

  private loadFromFile(): void {
    if (this.isLoaded) return;
    try {
      if (fs.existsSync(this.configPath)) {
        const cfgContent = fs.readFileSync(this.configPath, 'utf-8');
        const parsedCfg = JSON.parse(cfgContent);
        this.systemPricingConfig = { ...DEFAULT_PRICING_CONFIG, ...parsedCfg };
        logger.info('PRICING_REPO', `Loaded system pricing configuration from ${this.configPath}`);
      } else {
        this.systemPricingConfig = JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG));
      }
    } catch (e: any) {
      logger.error('PRICING_REPO', `Failed to load dynamic pricing config: ${e?.message}`);
      this.systemPricingConfig = JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG));
    }
    this.isLoaded = true;
  }

  private persistToDisk(): void {
    const jsonStr = JSON.stringify(this.systemPricingConfig, null, 2);
    try {
      fs.writeFileSync(this.tmpConfigPath, jsonStr, 'utf-8');
      try {
        fs.renameSync(this.tmpConfigPath, this.configPath);
      } catch {
        fs.writeFileSync(this.configPath, jsonStr, 'utf-8');
        if (fs.existsSync(this.tmpConfigPath)) {
          try {
            fs.unlinkSync(this.tmpConfigPath);
          } catch {}
        }
      }
    } catch (e: any) {
      logger.error('PRICING_REPO', `Failed to persist system pricing config: ${e?.message}`);
    }
  }

  public getPricingConfig(): PricingConfig {
    this.loadFromFile();
    return this.systemPricingConfig;
  }

  public async savePricingConfig(newConfig: Partial<PricingConfig>): Promise<PricingConfig> {
    this.loadFromFile();
    this.systemPricingConfig = {
      ...this.systemPricingConfig,
      ...newConfig,
      actionPricing: newConfig.actionPricing || this.systemPricingConfig.actionPricing,
      packages: newConfig.packages || this.systemPricingConfig.packages
    };

    this.persistToDisk();
    logger.info('PRICING_REPO', `Saved updated pricing configuration to ${this.configPath}`);
    return this.systemPricingConfig;
  }

  public async resetPricingConfig(): Promise<PricingConfig> {
    this.systemPricingConfig = JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG));
    this.persistToDisk();
    logger.info('PRICING_REPO', `Reset dynamic pricing config to factory defaults`);
    return this.systemPricingConfig;
  }

  public getActionCost(action: CreditActionType | string, defaultCost: number): number {
    const cfg = this.getPricingConfig();
    const found = cfg.actionPricing?.find((p: ActionPricingItem) => p.action === action);
    if (found && typeof found.credits === 'number' && found.credits >= 0) {
      return found.credits;
    }
    return defaultCost;
  }
}

export const pricingConfigRepository = new PricingConfigRepository();
