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
      name: '文章生成与发布 (按篇计费)', 
      credits: 100, 
      desc: '单篇标准定价 ($1.00/篇)：选题挖掘、3000+字高质量SEO长文、FAQ Schema、配图排版、站点同步发布与搜索引擎主动收录推送一站式全包',
      enabled: true 
    },
    { 
      action: 'COMPETITOR_ANALYSIS', 
      name: '我的词库 智能挖掘与拓词分析 (按次计费)', 
      credits: 50, 
      desc: '单次标准定价 ($0.50/次)：母词裂变拓词、高意图长尾挖掘、竞品词库逆向穿透与搜索意图聚类分析',
      enabled: true 
    }
  ],
  packages: [
    {
      id: 'pkg-10',
      name: '基础体验包 (可发 10 篇)',
      badge: '入门推荐',
      usdtAmount: 10,
      credits: 1000,
      bonusCredits: 0
    },
    {
      id: 'pkg-50',
      name: '专业进阶包 (可发 55 篇)',
      badge: '最受欢迎 (+10% 赠送)',
      usdtAmount: 50,
      credits: 5500,
      bonusCredits: 500,
      popular: true
    },
    {
      id: 'pkg-100',
      name: '企业旗舰包 (可发 120 篇)',
      badge: '超值加赠 (+20% 赠送)',
      usdtAmount: 100,
      credits: 12000,
      bonusCredits: 2000
    },
    {
      id: 'pkg-300',
      name: '霸屏尊享包 (可发 400 篇)',
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
    if (action === 'SITE_AUDIT') {
      return 0; // Free basic infrastructure service
    }

    const cfg = this.getPricingConfig();
    // Automatically map article actions (CRUISE_PIPELINE, AUTOPILOT_CRUISE, DRAFT_GENERATE) to the single configured article price
    const targetAction = (action === 'AUTOPILOT_CRUISE' || action === 'DRAFT_GENERATE') ? 'CRUISE_PIPELINE' : action;
    const found = cfg.actionPricing?.find((p: ActionPricingItem) => p.action === targetAction || p.action === action);
    if (found && typeof found.credits === 'number' && found.credits >= 0) {
      return found.credits;
    }
    return defaultCost;
  }

  public isActionEnabled(action: CreditActionType | string): boolean {
    if (action === 'SITE_AUDIT') {
      return true;
    }

    const cfg = this.getPricingConfig();
    const targetAction = (action === 'AUTOPILOT_CRUISE' || action === 'DRAFT_GENERATE') ? 'CRUISE_PIPELINE' : action;
    const found = cfg.actionPricing?.find((p: ActionPricingItem) => p.action === targetAction || p.action === action);
    return found ? found.enabled !== false : true;
  }
}

export const pricingConfigRepository = new PricingConfigRepository();
