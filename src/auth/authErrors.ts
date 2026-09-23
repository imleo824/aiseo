type AuthErrorLike = {
  code?: unknown;
  status?: unknown;
  name?: unknown;
};

const codeMessages: Record<string, string> = {
  invalid_credentials: '邮箱或密码不正确，请重新输入。',
  email_not_confirmed: '邮箱尚未验证，请先打开验证邮件完成验证。',
  email_exists: '该邮箱暂时无法注册，请尝试登录或找回密码。',
  user_already_exists: '该邮箱暂时无法注册，请尝试登录或找回密码。',
  weak_password: '密码强度不足，请使用至少 10 位且更难猜测的密码。',
  same_password: '新密码不能与当前密码相同。',
  over_email_send_rate_limit: '邮件发送过于频繁，请稍后再试。',
  over_request_rate_limit: '操作过于频繁，请几分钟后再试。',
  captcha_failed: '人机验证未通过，请重新验证后再试。',
  email_address_invalid: '请输入可正常收取邮件的有效邮箱地址。',
  email_address_not_authorized: '该邮箱暂时无法接收系统邮件，请更换邮箱或联系支持。',
  flow_state_expired: '此登录链接已过期，请重新发起操作。',
  flow_state_not_found: '此登录链接无效或已使用，请重新发起操作。',
  otp_expired: '此验证链接已过期，请重新获取。',
  user_banned: '该账号当前无法登录，请联系支持。',
  conflict: '账号状态正在更新，请稍后重试。',
  validation_failed: '提交的信息格式不正确，请检查后重试。',
  unexpected_failure: '认证服务暂时不可用，请稍后重试。',
  hook_timeout: '认证服务响应超时，请稍后重试。',
  hook_timeout_after_retry: '认证服务响应超时，请稍后重试。'
};

export const authErrorMessage = (error: unknown): string => {
  if (error && typeof error === 'object') {
    const authError = error as AuthErrorLike;
    if (typeof authError.code === 'string' && codeMessages[authError.code]) {
      return codeMessages[authError.code];
    }
    if (authError.status === 429) return '操作过于频繁，请几分钟后再试。';
    if (typeof authError.status === 'number' && authError.status >= 500) {
      return '认证服务暂时不可用，请稍后重试。';
    }
    if (authError.name === 'AuthRetryableFetchError' || authError.name === 'TypeError') {
      return '无法连接认证服务，请检查网络后重试。';
    }
  }
  return '操作未完成，请稍后重试。';
};
