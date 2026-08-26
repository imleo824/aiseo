import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationRole, PlatformRole } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  user: { findFirst: vi.fn() },
  session: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  auditEvent: { create: vi.fn() },
  transaction: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  createSessionToken: vi.fn()
}));

vi.mock('./env', () => ({ env: { sessionHours: 24 } }));
vi.mock('./prisma', () => ({
  prisma: {
    user: mocks.user,
    session: mocks.session,
    auditEvent: mocks.auditEvent,
    $transaction: mocks.transaction
  }
}));
vi.mock('../utils/auth', () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
  createSessionToken: mocks.createSessionToken
}));

import { sessionService, toAuthenticatedUser } from './sessionService';

const member = (role: OrganizationRole = OrganizationRole.OWNER) => ({
  organizationId: 'org-1',
  role,
  organization: { id: 'org-1', name: 'Example organization' }
});
const user = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  email: 'owner@example.com',
  username: 'owner',
  passwordHash: 'scrypt$stored',
  platformRole: PlatformRole.USER,
  memberships: [member()],
  ...overrides
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createSessionToken.mockReturnValue('opaque-session-token');
  mocks.hashPassword.mockResolvedValue('scrypt$hashed');
  mocks.verifyPassword.mockResolvedValue(true);
  mocks.transaction.mockImplementation(async (operation: (tx: unknown) => unknown) => operation({
    user: { create: vi.fn().mockResolvedValue(user()) },
    session: mocks.session,
    auditEvent: mocks.auditEvent
  }));
});

describe('persistent session service', () => {
  it('normalizes identities and maps only membership-backed organizations', () => {
    expect(toAuthenticatedUser(user({ memberships: [member(OrganizationRole.VIEWER)] }))).toEqual({
      id: 'user-1',
      email: 'owner@example.com',
      username: 'owner',
      platformRole: PlatformRole.USER,
      organizations: [{ id: 'org-1', name: 'Example organization', role: OrganizationRole.VIEWER }]
    });
  });

  it('registers a user, owner membership, opaque hashed session, and audit event atomically', async () => {
    mocks.user.findFirst.mockResolvedValue(null);
    const created = await sessionService.register({ email: ' OWNER@EXAMPLE.COM ', username: ' Owner ', password: 'a-strong-password', organizationName: ' Example organization ' });
    expect(created).toMatchObject({ token: 'opaque-session-token', user: { organizations: [{ role: OrganizationRole.OWNER }] } });
    expect(mocks.user.findFirst).toHaveBeenCalledWith({ where: { OR: [{ email: 'owner@example.com' }, { username: 'owner' }] }, select: { id: true } });
    expect(mocks.session.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1' }) }));
    expect(mocks.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'ORGANIZATION_CREATED' }) }));
  });

  it('rejects invalid registration and duplicate identifiers before creating a session', async () => {
    await expect(sessionService.register({ email: 'invalid', username: 'x', password: 'short', organizationName: 'x' })).rejects.toThrow('格式无效');
    mocks.user.findFirst.mockResolvedValue({ id: 'existing-user' });
    await expect(sessionService.register({ email: 'owner@example.com', username: 'owner', password: 'a-strong-password', organizationName: 'Example organization' })).rejects.toThrow('已被使用');
    expect(mocks.session.create).not.toHaveBeenCalled();
  });

  it('creates a revocable session only after verifying the password and rejects expired sessions', async () => {
    mocks.user.findFirst.mockResolvedValue(user());
    await expect(sessionService.login('OWNER@EXAMPLE.COM', 'a-strong-password')).resolves.toMatchObject({ token: 'opaque-session-token' });
    expect(mocks.session.create).toHaveBeenCalled();

    mocks.verifyPassword.mockResolvedValueOnce(false);
    await expect(sessionService.login('owner', 'wrong-password')).rejects.toThrow('账号或密码错误');

    mocks.session.findUnique.mockResolvedValueOnce({ user: user(), revokedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    await expect(sessionService.resolve('opaque-session-token')).resolves.toMatchObject({ id: 'user-1' });
    mocks.session.findUnique.mockResolvedValueOnce({ user: user(), revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
    await expect(sessionService.resolve('opaque-session-token')).rejects.toThrow('已失效');
    await sessionService.revoke('opaque-session-token');
    expect(mocks.session.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ revokedAt: null }) }));
  });

  it('enforces organization roles and isolated platform administration', () => {
    const viewer = toAuthenticatedUser(user({ memberships: [member(OrganizationRole.VIEWER)] }));
    expect(sessionService.assertOrganizationRole(viewer, 'org-1', [OrganizationRole.VIEWER])).toBe(OrganizationRole.VIEWER);
    expect(() => sessionService.assertOrganizationRole(viewer, 'org-1', [OrganizationRole.ADMIN])).toThrow('权限');
    expect(() => sessionService.assertOrganizationRole(viewer, 'other-org', [OrganizationRole.VIEWER])).toThrow('权限');
    expect(() => sessionService.assertPlatformAdmin(viewer)).toThrow('平台管理员');
    expect(() => sessionService.assertPlatformAdmin(toAuthenticatedUser(user({ platformRole: PlatformRole.PLATFORM_ADMIN })))).not.toThrow();
  });
});
