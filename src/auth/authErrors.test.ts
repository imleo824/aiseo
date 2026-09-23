import { describe, expect, it } from 'vitest';
import { authErrorMessage } from './authErrors';

describe('authErrorMessage', () => {
  it('maps stable Supabase auth codes to actionable Chinese messages', () => {
    expect(authErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' }))
      .toBe('邮箱或密码不正确，请重新输入。');
    expect(authErrorMessage({ code: 'email_not_confirmed' }))
      .toBe('邮箱尚未验证，请先打开验证邮件完成验证。');
    expect(authErrorMessage({ code: 'captcha_failed' }))
      .toBe('人机验证未通过，请重新验证后再试。');
  });

  it('handles rate limits and retryable network failures', () => {
    expect(authErrorMessage({ status: 429 })).toBe('操作过于频繁，请几分钟后再试。');
    expect(authErrorMessage({ name: 'AuthRetryableFetchError' }))
      .toBe('无法连接认证服务，请检查网络后重试。');
  });

  it('does not expose unknown provider errors', () => {
    expect(authErrorMessage(new Error('sensitive upstream response')))
      .toBe('操作未完成，请稍后重试。');
  });
});
