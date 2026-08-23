import { describe, it, expect } from 'vitest';
import { validateDomain, validateSiteInput, validateTaskInput, validateKnowledgeInput } from '../server/utils/validator';

describe('Validation Suite', () => {
  describe('validateDomain', () => {
    it('should correctly validate and sanitize domains', () => {
      expect(validateDomain('https://example.com/').isValid).toBe(true);
      expect(validateDomain('https://example.com/').sanitized).toBe('example.com');
      expect(validateDomain('http://sub.domain.org').sanitized).toBe('sub.domain.org');
      expect(validateDomain('invalid_domain').isValid).toBe(false);
      expect(validateDomain('').isValid).toBe(false);
    });
  });

  describe('validateSiteInput', () => {
    it('should reject invalid or missing domain', () => {
      const res = validateSiteInput({});
      expect(res.isValid).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
    });

    it('should accept valid site input', () => {
      const res = validateSiteInput({ domain: 'tech.example.com', siteLanguage: 'zh-CN' });
      expect(res.isValid).toBe(true);
      expect(res.errors.length).toBe(0);
    });
  });

  describe('validateTaskInput', () => {
    it('should validate task fields', () => {
      const invalid = validateTaskInput({ taskName: '', scheduleType: 'INVALID' });
      expect(invalid.isValid).toBe(false);

      const valid = validateTaskInput({ taskName: 'Daily Crawl', scheduleType: 'DAILY', articleCountPerRun: 2 });
      expect(valid.isValid).toBe(true);
    });
  });

  describe('validateKnowledgeInput', () => {
    it('should reject empty title or contentSnippet', () => {
      const res = validateKnowledgeInput({ title: '', contentSnippet: '' });
      expect(res.isValid).toBe(false);
    });

    it('should accept valid knowledge payload', () => {
      const res = validateKnowledgeInput({ title: 'K8s Whitepaper', contentSnippet: 'Benchmarks show 35% latency drop.' });
      expect(res.isValid).toBe(true);
    });
  });
});
