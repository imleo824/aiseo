import { createHash, randomUUID } from 'crypto';
import { OrganizationRole, PlatformRole } from '@prisma/client';
import { createSessionToken, hashPassword, verifyPassword } from '../utils/auth';
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from '../domain/errors';
import { env } from './env';
import { prisma } from './prisma';

const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');
const normalizeIdentifier = (value: string) => value.trim().toLowerCase();

export type AuthenticatedUser = {
  id: string;
  email: string;
  username: string;
  platformRole: PlatformRole;
  organizations: Array<{ id: string; name: string; role: OrganizationRole }>;
};

export const toAuthenticatedUser = (user: {
  id: string; email: string; username: string; platformRole: PlatformRole;
  memberships: Array<{ role: OrganizationRole; organization: { id: string; name: string } }>;
}): AuthenticatedUser => ({
  id: user.id,
  email: user.email,
  username: user.username,
  platformRole: user.platformRole,
  organizations: user.memberships.map(({ role, organization }) => ({ ...organization, role }))
});

export const sessionService = {
  async register(input: { email: string; username: string; password: string; organizationName: string }): Promise<{ token: string; user: AuthenticatedUser }> {
    const email = normalizeIdentifier(input.email);
    const username = normalizeIdentifier(input.username);
    const organizationName = input.organizationName.trim();
    if (!/^\S+@\S+\.\S+$/.test(email) || username.length < 3 || organizationName.length < 2) {
      throw new ValidationError('邮箱、用户名或组织名称格式无效');
    }
    if (input.password.length < 12) throw new ValidationError('密码至少需要 12 个字符');

    const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] }, select: { id: true } });
    if (existing) throw new ConflictError('邮箱或用户名已被使用');

    const passwordHash = await hashPassword(input.password);
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + env.sessionHours * 60 * 60 * 1000);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          id: randomUUID(), email, username, passwordHash,
          memberships: { create: { role: OrganizationRole.OWNER, organization: { create: { name: organizationName } } } }
        },
        include: { memberships: { include: { organization: true } } }
      });
      await tx.session.create({ data: { tokenHash: hashToken(token), userId: created.id, expiresAt } });
      await tx.auditEvent.create({ data: { actorId: created.id, action: 'ORGANIZATION_CREATED', targetType: 'organization', targetId: created.memberships[0].organizationId } });
      return created;
    });
    return { token, user: toAuthenticatedUser(user) };
  },

  async login(identifier: string, password: string): Promise<{ token: string; user: AuthenticatedUser }> {
    const normalized = normalizeIdentifier(identifier);
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: normalized }, { username: normalized }] },
      include: { memberships: { include: { organization: true } } }
    });
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedError('账号或密码错误');
    const token = createSessionToken();
    await prisma.session.create({ data: { tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + env.sessionHours * 60 * 60 * 1000) } });
    return { token, user: toAuthenticatedUser(user) };
  },

  async resolve(token?: string): Promise<AuthenticatedUser> {
    if (!token) throw new UnauthorizedError('登录会话不存在');
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: { memberships: { include: { organization: true } } } } }
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new UnauthorizedError('登录会话已失效');
    return toAuthenticatedUser(session.user);
  },

  async revoke(token?: string): Promise<void> {
    if (!token) return;
    await prisma.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  },

  assertOrganizationRole(user: AuthenticatedUser, organizationId: string, allowed: OrganizationRole[]): OrganizationRole {
    const membership = user.organizations.find((organization) => organization.id === organizationId);
    if (!membership || !allowed.includes(membership.role)) throw new ForbiddenError('没有此组织或执行该操作的权限');
    return membership.role;
  },

  assertPlatformAdmin(user: AuthenticatedUser): void {
    if (user.platformRole !== PlatformRole.PLATFORM_ADMIN) throw new ForbiddenError('仅平台管理员可执行该操作');
  }
};
