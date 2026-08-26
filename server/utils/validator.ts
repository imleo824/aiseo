export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export function validateDomain(domain: string): { isValid: boolean; sanitized: string } {
  if (!domain || typeof domain !== 'string') {
    return { isValid: false, sanitized: '' };
  }
  let sanitized = domain.trim().toLowerCase();
  sanitized = sanitized.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const blockedHosts = ['localhost', 'localhost.localdomain'];
  const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(sanitized) || sanitized.includes(':');
  const isInternalName = sanitized.endsWith('.local') || sanitized.endsWith('.internal');
  return {
    isValid: domainRegex.test(sanitized) && !blockedHosts.includes(sanitized) && !isIpLiteral && !isInternalName,
    sanitized
  };
}

export function validateSiteInput(body: any): ValidationResult {
  const errors: string[] = [];
  if (!body || typeof body !== 'object') {
    return { isValid: false, errors: ['请求主体不能为空'] };
  }

  const { domain, siteLanguage, baiduToken, googleServiceAccountJson } = body;
  if (!domain || typeof domain !== 'string') {
    errors.push('域名 (domain) 不能为空');
  } else {
    const { isValid } = validateDomain(domain);
    if (!isValid) {
      errors.push('域名格式不正确 (例如: example.com)');
    }
  }

  if (siteLanguage && typeof siteLanguage !== 'string') {
    errors.push('语言格式不正确');
  }

  // 站点级百度主动推送 Token 校验 (选填)
  if (baiduToken !== undefined && baiduToken !== null && String(baiduToken).trim() !== '') {
    const tokenStr = String(baiduToken).trim();
    if (tokenStr.length < 6 || tokenStr.length > 64) {
      errors.push('百度主动推送 API Token 长度通常在 6 到 64 个字符之间');
    }
  }

  // 站点级 Google Service Account JSON 凭证校验 (选填)
  if (googleServiceAccountJson !== undefined && googleServiceAccountJson !== null && String(googleServiceAccountJson).trim() !== '') {
    try {
      const parsed = JSON.parse(String(googleServiceAccountJson).trim());
      if (!parsed || typeof parsed !== 'object') {
        errors.push('Google Service Account 凭证必须是有效的 JSON 文本');
      } else if (parsed.type && parsed.type !== 'service_account') {
        errors.push('Google 凭证 JSON 中的 "type" 字段必须为 "service_account"');
      } else if (!parsed.client_email || !parsed.private_key) {
        errors.push('Google 凭证 JSON 缺少必需的 client_email 或 private_key 字段');
      }
    } catch {
      errors.push('Google Service Account JSON 语法错误，无法解析');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

export function validateTaskInput(body: any): ValidationResult {
  const errors: string[] = [];
  if (!body || typeof body !== 'object') {
    return { isValid: false, errors: ['请求主体不能为空'] };
  }

  const { taskName, scheduleType, articleCountPerRun } = body;
  if (!taskName || typeof taskName !== 'string' || taskName.trim().length === 0) {
    errors.push('任务名称 (taskName) 不能为空');
  }

  if (scheduleType && !['DAILY', 'WEEKLY', 'MONTHLY'].includes(scheduleType)) {
    errors.push('调度周期 (scheduleType) 必须为 DAILY, WEEKLY 或 MONTHLY');
  }

  if (articleCountPerRun !== undefined) {
    const count = Number(articleCountPerRun);
    if (isNaN(count) || count < 1 || count > 50) {
      errors.push('单次生成篇数 (articleCountPerRun) 必须在 1 到 50 之间');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

export function generateSeoSlug(titleOrKeyword: string): string {
  if (!titleOrKeyword || typeof titleOrKeyword !== 'string') return 'article-post';
  
  // Clean prefix tags like [二次创作/改写] or [竞品对标截流]
  let cleaned = titleOrKeyword.replace(/\[.*?\]/g, '').trim();
  
  // Extract alphanumeric sequences or Latin characters
  const latinMatches = cleaned.match(/[a-zA-Z0-9]+/g);
  if (latinMatches && latinMatches.join('-').length >= 4) {
    return latinMatches.join('-').toLowerCase().slice(0, 60);
  }

  // Fallback slug generation for non-latin titles
  const hexHash = Buffer.from(cleaned).toString('hex').slice(0, 8);
  return `guide-${hexHash}`;
}

export function validateKnowledgeInput(body: any): ValidationResult {
  const errors: string[] = [];
  if (!body || typeof body !== 'object') {
    return { isValid: false, errors: ['请求主体不能为空'] };
  }

  const { title, contentSnippet } = body;
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    errors.push('知识库标题 (title) 不能为空');
  }

  if (!contentSnippet || typeof contentSnippet !== 'string' || contentSnippet.trim().length === 0) {
    errors.push('事实摘要内容 (contentSnippet) 不能为空');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

export function isValidHttpUrl(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const parsed = new URL(urlStr.trim());
    const host = parsed.hostname.toLowerCase();
    const blocked = host === 'localhost'
      || host.endsWith('.local')
      || host.endsWith('.internal')
      || /^127\./.test(host)
      || /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^169\.254\./.test(host)
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
      || host === '::1'
      || /^f[cd][0-9a-f:]+$/i.test(host)
      || /^fe80:/i.test(host);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !blocked;
  } catch {
    return false;
  }
}

export function validateSystemServicesConfig(config: any): ValidationResult {
  const errors: string[] = [];
  if (!config || typeof config !== 'object') {
    return { isValid: false, errors: ['配置数据不能为空且必须为对象'] };
  }

  // 1. AI Engine
  if (config.aiEngine) {
    const ai = config.aiEngine;
    if (ai.geminiModel !== undefined) {
      if (typeof ai.geminiModel !== 'string' || ai.geminiModel.trim().length === 0) {
        errors.push('AI 模型名称 (geminiModel) 不能为空');
      } else if (ai.geminiModel.length > 64) {
        errors.push('AI 模型名称长度不能超过 64 个字符');
      }
    }

    if (ai.temperature !== undefined) {
      const temp = Number(ai.temperature);
      if (isNaN(temp) || temp < 0 || temp > 2.0) {
        errors.push('AI 生成温度 (temperature) 必须在 0.0 到 2.0 之间');
      }
    }

    if (ai.maxOutputTokens !== undefined) {
      const tokens = Number(ai.maxOutputTokens);
      if (isNaN(tokens) || tokens < 256 || tokens > 32768) {
        errors.push('AI 最大输出 Token 数 (maxOutputTokens) 必须在 256 到 32768 之间');
      }
    }

    if (ai.maxConcurrency !== undefined) {
      const concurrency = Number(ai.maxConcurrency);
      if (isNaN(concurrency) || concurrency < 1 || concurrency > 50) {
        errors.push('AI 最大并发请求数 (maxConcurrency) 必须在 1 到 50 之间');
      }
    }

    if (ai.timeoutMs !== undefined) {
      const timeout = Number(ai.timeoutMs);
      if (isNaN(timeout) || timeout < 5000 || timeout > 300000) {
        errors.push('AI 超时时间 (timeoutMs) 必须在 5000ms 到 300000ms 之间');
      }
    }

    if (ai.customEndpoint && typeof ai.customEndpoint === 'string' && ai.customEndpoint.trim().length > 0) {
      if (!isValidHttpUrl(ai.customEndpoint)) {
        errors.push('AI 自定义接口地址 (customEndpoint) 必须为有效的 HTTP/HTTPS URL');
      }
    }
  }

  // 2. SERP Data
  if (config.serpData) {
    const serp = config.serpData;
    if (serp.cacheTtlHours !== undefined) {
      const ttl = Number(serp.cacheTtlHours);
      if (isNaN(ttl) || ttl < 1 || ttl > 720) {
        errors.push('SERP 缓存时长 (cacheTtlHours) 必须在 1 到 720 小时之间 (最长 30 天)');
      }
    }
    if (serp.defaultLocation && typeof serp.defaultLocation === 'string') {
      if (serp.defaultLocation.trim().length > 20) {
        errors.push('SERP 默认地区代码长度不能超过 20 字符');
      }
    }
    if (serp.defaultLanguage && typeof serp.defaultLanguage === 'string') {
      if (serp.defaultLanguage.trim().length > 20) {
        errors.push('SERP 默认语言代码长度不能超过 20 字符');
      }
    }
  }

  // 4. Media Service
  if (config.mediaService) {
    const media = config.mediaService;
    if (media.imageOrientation && !['landscape', 'portrait', 'squarish'].includes(media.imageOrientation)) {
      errors.push('配图构图比例必须为 landscape, portrait 或 squarish');
    }
  }

  // 5. Blockchain Gateway
  if (config.blockchainGateway) {
    const bg = config.blockchainGateway;
    if (bg.requiredConfirmations !== undefined) {
      const conf = Number(bg.requiredConfirmations);
      if (isNaN(conf) || conf < 1 || conf > 100) {
        errors.push('USDT 充值安全区块确认数必须在 1 到 100 之间 (推荐 19)');
      }
    }
    if (bg.autoScanIntervalSeconds !== undefined) {
      const interval = Number(bg.autoScanIntervalSeconds);
      if (isNaN(interval) || interval < 5 || interval > 600) {
        errors.push('区块链轮询扫描间隔必须在 5 到 600 秒之间');
      }
    }
    if (bg.customRpcUrl && typeof bg.customRpcUrl === 'string' && bg.customRpcUrl.trim().length > 0) {
      if (!isValidHttpUrl(bg.customRpcUrl)) {
        errors.push('TRON RPC 节点地址必须为有效的 HTTP/HTTPS URL');
      }
    }
  }

  // 6. Network Policy
  if (config.networkPolicy) {
    const np = config.networkPolicy;
    if (np.requestTimeoutMs !== undefined) {
      const timeout = Number(np.requestTimeoutMs);
      if (isNaN(timeout) || timeout < 1000 || timeout > 120000) {
        errors.push('网络全局请求超时时间必须在 1000ms 到 120000ms 之间');
      }
    }
    if (np.maxRetries !== undefined) {
      const retries = Number(np.maxRetries);
      if (isNaN(retries) || retries < 0 || retries > 10) {
        errors.push('网络请求最大重试次数必须在 0 到 10 之间');
      }
    }
    if (np.concurrencyLimitPerSite !== undefined) {
      const limit = Number(np.concurrencyLimitPerSite);
      if (isNaN(limit) || limit < 1 || limit > 20) {
        errors.push('单站点并发访问限制必须在 1 到 20 之间');
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}
