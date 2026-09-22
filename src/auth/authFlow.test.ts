import { describe, expect, it } from 'vitest';
import { nextRecoveryState, resolveAuthView } from './authFlow';

describe('authentication flow', () => {
  it('shows password recovery before an authenticated workspace', () => {
    expect(resolveAuthView({ loading: false, recovery: true, hasUser: true, emailConfirmed: true })).toBe('RECOVERY');
  });

  it('keeps recovery active across token refresh and user update events', () => {
    expect(nextRecoveryState(true, 'TOKEN_REFRESHED')).toBe(true);
    expect(nextRecoveryState(true, 'USER_UPDATED')).toBe(true);
    expect(nextRecoveryState(true, 'SIGNED_OUT')).toBe(false);
  });

  it('routes ordinary authentication states deterministically', () => {
    expect(resolveAuthView({ loading: true, recovery: false, hasUser: false, emailConfirmed: false })).toBe('LOADING');
    expect(resolveAuthView({ loading: false, recovery: false, hasUser: false, emailConfirmed: false })).toBe('LOGIN');
    expect(resolveAuthView({ loading: false, recovery: false, hasUser: true, emailConfirmed: false })).toBe('VERIFY_EMAIL');
    expect(resolveAuthView({ loading: false, recovery: false, hasUser: true, emailConfirmed: true })).toBe('WORKSPACE');
  });
});
