import * as fs from 'fs';
import * as path from 'path';
import { SystemServicesConfig } from '../../../src/types/seo';
import { logger } from '../../utils/logger';

export const DEFAULT_SYSTEM_SERVICES_CONFIG: SystemServicesConfig = {
  aiEngine: {
    provider: 'GEMINI',
    geminiModel: 'gemini-2.5-flash',
    fallbackModel: 'gemini-1.5-flash',
    temperature: 0.7,
    maxOutputTokens: 8192,
    customEndpoint: '',
    customApiKey: '',
    maxConcurrency: 5,
    timeoutMs: 60000,
    systemPromptPrefix: '你是一个顶级的 SEO 内容架构专家与搜索引擎意图优化引擎。'
  },
  searchEngine: {
    googleIndexing: {
      enabled: true,
      serviceAccountJson: '',
      defaultAction: 'URL_UPDATED'
    },
    baiduPush: {
      enabled: true,
      siteDomain: 'https://example.com',
      token: 'bd_token_demo_98234',
      dailyQuotaThreshold: 20
    },
    bingIndexNow: {
      enabled: true,
      apiKey: 'in_key_993418247012',
      keyLocation: 'https://example.com/indexnow-key.txt',
      autoPushOnPublish: true
    },
    sitemapPing: {
      enabled: true,
      engines: ['Google', 'Bing', 'Yandex']
    }
  },
  serpData: {
    provider: 'HYBRID_ENGINE',
    dataForSeoLogin: '',
    dataForSeoPassword: '',
    serpApiKey: '',
    googleCseKey: '',
    googleCseCx: '',
    defaultLocation: 'US',
    defaultLanguage: 'en',
    cacheTtlHours: 48
  },
  mediaService: {
    imageProvider: 'GEMINI_IMAGEN',
    unsplashAccessKey: '',
    pexelsApiKey: '',
    imageOrientation: 'landscape',
    autoInsertAlt: true,
    compressWebp: true
  },
  webhookNotification: {
    enabled: false,
    webhookType: 'FEISHU',
    webhookUrl: '',
    secretKey: '',
    events: {
      onPublishSuccess: true,
      onTaskFailure: true,
      onLowCreditAlert: true,
      onNewTopupPending: true
    },
    lowCreditThreshold: 100
  },
  blockchainGateway: {
    network: 'TRC20',
    tronGridApiKey: '',
    customRpcUrl: 'https://api.trongrid.io',
    requiredConfirmations: 19,
    autoScanIntervalSeconds: 30
  },
  networkPolicy: {
    requestTimeoutMs: 15000,
    maxRetries: 3,
    crawlerUserAgent: 'Mozilla/5.0 (compatible; SEOSaaS-Crawler/2.0; +https://seo-saas.com/bot)',
    concurrencyLimitPerSite: 2
  }
};

export class SystemServiceConfigRepository {
  private configPath = path.join(process.cwd(), 'system_services_config.json');
  private tmpConfigPath = path.join(process.cwd(), 'system_services_config.json.tmp');
  private config: SystemServicesConfig = JSON.parse(JSON.stringify(DEFAULT_SYSTEM_SERVICES_CONFIG));
  private isLoaded = false;

  constructor() {
    this.loadFromFile();
  }

  private loadFromFile(): void {
    if (this.isLoaded) return;
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.config = this.deepMerge(DEFAULT_SYSTEM_SERVICES_CONFIG, parsed);
        logger.info('SERVICE_CONFIG', `Loaded system services configuration from ${this.configPath}`);
      } else {
        this.config = JSON.parse(JSON.stringify(DEFAULT_SYSTEM_SERVICES_CONFIG));
      }
    } catch (err: any) {
      logger.error('SERVICE_CONFIG', `Failed to load services config file: ${err?.message}`);
      this.config = JSON.parse(JSON.stringify(DEFAULT_SYSTEM_SERVICES_CONFIG));
    }
    this.isLoaded = true;
  }

  private deepMerge(target: any, source: any): any {
    const output = { ...target };
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    return output;
  }

  private isObject(item: any): boolean {
    return item && typeof item === 'object' && !Array.isArray(item);
  }

  private persistToDisk(): void {
    const jsonStr = JSON.stringify(this.config, null, 2);
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
    } catch (err: any) {
      logger.error('SERVICE_CONFIG', `Failed to persist system services config: ${err?.message}`);
    }
  }

  public getServicesConfig(): SystemServicesConfig {
    this.loadFromFile();
    return this.config;
  }

  public getMaskedConfig(): SystemServicesConfig {
    this.loadFromFile();
    const masked: SystemServicesConfig = JSON.parse(JSON.stringify(this.config));
    
    // Mask sensitive keys for security in client view
    if (masked.aiEngine.customApiKey) {
      masked.aiEngine.customApiKey = this.maskSecret(masked.aiEngine.customApiKey);
    }
    if (masked.searchEngine.baiduPush.token) {
      masked.searchEngine.baiduPush.token = this.maskSecret(masked.searchEngine.baiduPush.token);
    }
    if (masked.searchEngine.bingIndexNow.apiKey) {
      masked.searchEngine.bingIndexNow.apiKey = this.maskSecret(masked.searchEngine.bingIndexNow.apiKey);
    }
    if (masked.serpData.dataForSeoPassword) {
      masked.serpData.dataForSeoPassword = this.maskSecret(masked.serpData.dataForSeoPassword);
    }
    if (masked.serpData.serpApiKey) {
      masked.serpData.serpApiKey = this.maskSecret(masked.serpData.serpApiKey);
    }
    if (masked.mediaService.unsplashAccessKey) {
      masked.mediaService.unsplashAccessKey = this.maskSecret(masked.mediaService.unsplashAccessKey);
    }
    if (masked.mediaService.pexelsApiKey) {
      masked.mediaService.pexelsApiKey = this.maskSecret(masked.mediaService.pexelsApiKey);
    }
    if (masked.webhookNotification.secretKey) {
      masked.webhookNotification.secretKey = this.maskSecret(masked.webhookNotification.secretKey);
    }
    if (masked.blockchainGateway.tronGridApiKey) {
      masked.blockchainGateway.tronGridApiKey = this.maskSecret(masked.blockchainGateway.tronGridApiKey);
    }

    return masked;
  }

  private maskSecret(val: string): string {
    if (!val || val.length <= 6) return '******';
    return val.slice(0, 3) + '****' + val.slice(-3);
  }

  public async saveServicesConfig(incoming: Partial<SystemServicesConfig>): Promise<SystemServicesConfig> {
    this.loadFromFile();

    const unmasked = this.restoreMaskedSecrets(incoming, this.config);
    this.config = this.deepMerge(this.config, unmasked);
    this.persistToDisk();
    logger.info('SERVICE_CONFIG', `Successfully updated system services config`);
    return this.config;
  }

  private restoreMaskedSecrets(incoming: any, current: any): any {
    const result = JSON.parse(JSON.stringify(incoming));

    const checkAndRestore = (obj: any, currentObj: any, pathKeys: string[]) => {
      let target = obj;
      let curr = currentObj;
      for (let i = 0; i < pathKeys.length - 1; i++) {
        if (!target || !curr) return;
        target = target[pathKeys[i]];
        curr = curr[pathKeys[i]];
      }
      const lastKey = pathKeys[pathKeys.length - 1];
      if (target && curr && typeof target[lastKey] === 'string' && target[lastKey].includes('****')) {
        target[lastKey] = curr[lastKey];
      }
    };

    checkAndRestore(result, current, ['aiEngine', 'customApiKey']);
    checkAndRestore(result, current, ['searchEngine', 'baiduPush', 'token']);
    checkAndRestore(result, current, ['searchEngine', 'bingIndexNow', 'apiKey']);
    checkAndRestore(result, current, ['serpData', 'dataForSeoPassword']);
    checkAndRestore(result, current, ['serpData', 'serpApiKey']);
    checkAndRestore(result, current, ['mediaService', 'unsplashAccessKey']);
    checkAndRestore(result, current, ['mediaService', 'pexelsApiKey']);
    checkAndRestore(result, current, ['webhookNotification', 'secretKey']);
    checkAndRestore(result, current, ['blockchainGateway', 'tronGridApiKey']);

    return result;
  }

  public async resetServicesConfig(): Promise<SystemServicesConfig> {
    this.config = JSON.parse(JSON.stringify(DEFAULT_SYSTEM_SERVICES_CONFIG));
    this.persistToDisk();
    logger.info('SERVICE_CONFIG', `Reset system services config to factory defaults`);
    return this.config;
  }
}

export const systemServiceConfigRepository = new SystemServiceConfigRepository();
