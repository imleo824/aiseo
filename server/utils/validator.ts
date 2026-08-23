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
  return {
    isValid: domainRegex.test(sanitized),
    sanitized
  };
}

export function validateSiteInput(body: any): ValidationResult {
  const errors: string[] = [];
  if (!body || typeof body !== 'object') {
    return { isValid: false, errors: ['请求主体不能为空'] };
  }

  const { domain, siteLanguage } = body;
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
