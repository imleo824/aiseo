import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { DraftStatus, GrowthActionStatus, GrowthInputType, GrowthProgramMode, GrowthProgramStatus, GrowthRunStatus, JobType, OrganizationRole, Prisma, ReviewDecision, SiteConnectionStatus } from '@prisma/client';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../domain/errors';
import { revokeOwnSessions, revalidateSensitiveSession, requireAuth } from './auth';
import { billingService } from './billingService';
import { asyncRoute, cursorPage, parseBody, sendData } from './http';
import { executeIdempotent, requireIdempotencyKey } from './idempotency';
import { jobService } from './jobService';
import { withRequestScope, withSerializableScope, type TransactionClient } from './prisma';
import { currentEncryptionKeyVersion, encryptSecret } from './crypto';
import { env } from './env';
import { gscProvider } from './providers';
import { wordPressService } from './wordpress';
import { gscComparisonWindow } from './growthEngine';
import { growthProgramService } from './growthProgramService';
import { parsePublishingConfirmationPolicy, PUBLISH_CONFIRMATION_SETTING_KEY } from './publishingPolicy';

const roleRank: Record<OrganizationRole, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2, OWNER: 3 };
const idSchema = z.string().uuid();
const languageSchema = z.enum(['zh-CN', 'en-US']);
const siteSchema = z.object({ name: z.string().trim().min(1).max(120), domain: z.string().trim().min(3).max(253), language: languageSchema.default('zh-CN') });
const siteUpdateSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), domain: z.string().trim().min(3).max(253).optional(), language: languageSchema.optional() }).refine((value) => Object.keys(value).length > 0, '至少提供一个站点字段');
const memberSchema = z.object({ profileId: z.string().uuid(), role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']) });
const growthInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('KEYWORD'), value: z.string().trim().min(2).max(200) }),
  z.object({ type: z.literal('REFERENCE_URL'), value: z.string().url().max(2_000).refine((value) => value.startsWith('https://'), '参考文章必须使用 HTTPS') }),
  z.object({ type: z.literal('COMPETITOR_SITE'), value: z.string().url().max(2_000).refine((value) => value.startsWith('https://'), '竞品站点必须使用 HTTPS') })
]);
const growthProgramSchema = z.object({
  mode: z.enum(['ONCE', 'CONTINUOUS']),
  input: growthInputSchema,
  budgetLimitMicros: z.string().regex(/^\d+$/).transform(BigInt).optional()
});

const userId = (request: Request): string => {
  if (!request.authUser) throw new ForbiddenError('认证上下文缺失');
  return request.authUser.id;
};

const organizationId = (request: Request): string => idSchema.parse(request.params.organizationId);

const assertRole = async (tx: TransactionClient, profileId: string, orgId: string, minimum: OrganizationRole): Promise<OrganizationRole> => {
  const membership = await tx.organizationMember.findUnique({ where: { organizationId_profileId: { organizationId: orgId, profileId } } });
  if (!membership || roleRank[membership.role] < roleRank[minimum]) throw new ForbiddenError('没有此组织或执行该操作的权限');
  return membership.role;
};

const assertExecutionProviders = async (tx: TransactionClient): Promise<void> => {
  const heartbeat = await tx.workerHeartbeat.findFirst({ orderBy: { heartbeatAt: 'desc' } });
  const online = Boolean(heartbeat && heartbeat.heartbeatAt > new Date(Date.now() - 45_000));
  const capabilities = heartbeat?.capabilities && typeof heartbeat.capabilities === 'object' && !Array.isArray(heartbeat.capabilities)
    ? heartbeat.capabilities as Record<string, unknown>
    : {};
  if (!online) throw new ConflictError('Worker 当前离线，无法接受正式执行任务');
  if (capabilities.dataForSeo !== true) throw new ConflictError('DataForSEO 尚未在 Worker 配置，无法获取真实 SEO 数据');
  if (capabilities.contentAi !== true) throw new ConflictError('OpenAI/Gemini 尚未在 Worker 配置，无法生成正式内容');
};

const idempotencyKey = (request: Request): string => requireIdempotencyKey(request.header('idempotency-key'));

export const apiRouter = Router();

type GscState = { organizationId: string; profileId: string; siteId: string; propertyId: string; nonce: string; expiresAt: number };
type WordPressState = { organizationId: string; profileId: string; siteId: string; nonce: string; expiresAt: number };
const signGscState = (state: GscState): string => {
  if (!env.gscStateSecret) throw new ValidationError('GSC_STATE_SECRET 尚未配置');
  const body = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${body}.${createHmac('sha256', env.gscStateSecret).update(body).digest('base64url')}`;
};
const readGscState = (value: string): GscState => {
  const [body, signature] = value.split('.');
  if (!body || !signature || !env.gscStateSecret) throw new ValidationError('GSC OAuth state 无效');
  const expected = createHmac('sha256', env.gscStateSecret).update(body).digest('base64url');
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new ValidationError('GSC OAuth state 签名无效');
  const state = JSON.parse(Buffer.from(body, 'base64url').toString()) as GscState;
  if (state.expiresAt < Date.now()) throw new ValidationError('GSC OAuth state 已过期');
  return state;
};

const signWordPressState = (state: WordPressState): string => {
  if (!env.gscStateSecret) throw new ValidationError('OAuth state secret 尚未配置');
  const body = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${body}.${createHmac('sha256', env.gscStateSecret).update(`wordpress:${body}`).digest('base64url')}`;
};
const readWordPressState = (value: string): WordPressState => {
  const [body, signature] = value.split('.');
  if (!body || !signature || !env.gscStateSecret) throw new ValidationError('WordPress OAuth state 无效');
  const expected = createHmac('sha256', env.gscStateSecret).update(`wordpress:${body}`).digest('base64url');
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new ValidationError('WordPress OAuth state 签名无效');
  const state = JSON.parse(Buffer.from(body, 'base64url').toString()) as WordPressState;
  if (state.expiresAt < Date.now()) throw new ValidationError('WordPress OAuth state 已过期');
  return state;
};

apiRouter.get('/integrations/gsc/callback', asyncRoute(async (request, response) => {
  const state = readGscState(String(request.query.state || ''));
  const code = String(request.query.code || '');
  if (!code) throw new ValidationError('Google 未返回授权码');
  await withRequestScope({ profileId: state.profileId, organizationId: state.organizationId }, async (tx) => {
    await assertRole(tx, state.profileId, state.organizationId, OrganizationRole.EDITOR);
    const pending = await tx.idempotencyKey.findFirst({ where: { organizationId: state.organizationId, profileId: state.profileId, key: state.nonce, requestHash: 'gsc-oauth-state', expiresAt: { gt: new Date() } } });
    if (!pending) throw new ConflictError('GSC OAuth state 已使用或不存在');
  });
  const credentials = await gscProvider.exchangeCode(code);
  await withRequestScope({ profileId: state.profileId, organizationId: state.organizationId }, async (tx) => {
    const connection = await tx.integrationConnection.upsert({ where: { siteId_provider: { siteId: state.siteId, provider: 'GSC' } }, create: { organizationId: state.organizationId, siteId: state.siteId, provider: 'GSC', propertyId: state.propertyId, encryptedCredentials: encryptSecret(credentials), keyVersion: currentEncryptionKeyVersion(), status: SiteConnectionStatus.VERIFYING }, update: { propertyId: state.propertyId, encryptedCredentials: encryptSecret(credentials), keyVersion: currentEncryptionKeyVersion(), status: SiteConnectionStatus.VERIFYING, lastErrorCode: null, lastErrorMessage: null } });
    const end = new Date(Date.now() - 3 * 86_400_000);
    const start = new Date(end.getTime() - 27 * 86_400_000);
    const date = (value: Date) => value.toISOString().slice(0, 10);
    await jobService.create(tx, {
      organizationId: state.organizationId,
      type: JobType.GSC_SYNC,
      idempotencyKey: `gsc-initial:${connection.id}:${date(end)}`,
      payload: { connectionId: connection.id, siteId: state.siteId, startDate: date(start), endDate: date(end) }
    });
    await tx.idempotencyKey.deleteMany({ where: { organizationId: state.organizationId, profileId: state.profileId, key: state.nonce } });
    await tx.auditEvent.create({ data: { organizationId: state.organizationId, actorId: state.profileId, action: 'GSC_AUTHORIZED', targetType: 'site', targetId: state.siteId, metadata: { propertyId: state.propertyId, initialSyncQueued: true } } });
  });
  response.redirect('/?gsc=syncing');
}));

apiRouter.get('/integrations/wordpress/callback', asyncRoute(async (request, response) => {
  const state = readWordPressState(String(request.query.state || ''));
  const siteUrl = String(request.query.site_url || '');
  const username = String(request.query.user_login || '');
  const applicationPassword = String(request.query.password || '');
  if (!siteUrl || !username || !applicationPassword) throw new ValidationError('WordPress 未返回完整授权凭证');
  const site = await withRequestScope({ profileId: state.profileId, organizationId: state.organizationId }, async (tx) => {
    await assertRole(tx, state.profileId, state.organizationId, OrganizationRole.EDITOR);
    const pending = await tx.idempotencyKey.findFirst({ where: { organizationId: state.organizationId, profileId: state.profileId, key: state.nonce, requestHash: 'wordpress-oauth-state', expiresAt: { gt: new Date() } } });
    if (!pending) throw new ConflictError('WordPress OAuth state 已使用或不存在');
    const found = await tx.site.findFirst({ where: { id: state.siteId, organizationId: state.organizationId } });
    if (!found) throw new NotFoundError('站点不存在');
    const authorizedOrigin = new URL(siteUrl).origin;
    const expectedOrigin = new URL(found.domain.startsWith('https://') ? found.domain : `https://${found.domain}`).origin;
    if (authorizedOrigin !== expectedOrigin) throw new ValidationError('WordPress 授权站点与绑定站点不一致');
    return found;
  });
  const encrypted = wordPressService.encrypt({ username, applicationPassword });
  const verified = await wordPressService.testConnection(site.domain, encrypted);
  await withRequestScope({ profileId: state.profileId, organizationId: state.organizationId }, async (tx) => {
    await tx.site.update({ where: { id: state.siteId }, data: { wordpressCredentials: encrypted, wordpressCredentialKeyVersion: currentEncryptionKeyVersion(), wordpressStatus: SiteConnectionStatus.CONNECTED, wordpressUser: verified.user, wordpressVerifiedAt: new Date() } });
    await tx.idempotencyKey.deleteMany({ where: { organizationId: state.organizationId, profileId: state.profileId, key: state.nonce } });
    await tx.auditEvent.create({ data: { organizationId: state.organizationId, actorId: state.profileId, action: 'WORDPRESS_AUTHORIZED', targetType: 'site', targetId: state.siteId, metadata: { user: verified.user, siteName: verified.siteName, authorization: 'APPLICATION_PASSWORD_FLOW' } } });
  });
  response.redirect(`/?wordpress=connected&siteId=${encodeURIComponent(state.siteId)}`);
}));

apiRouter.use(requireAuth);

apiRouter.get('/me', asyncRoute(async (request, response) => {
  const profileId = userId(request);
  const result = await withRequestScope({ profileId }, async (tx) => {
    await tx.$executeRaw`SELECT private.ensure_personal_workspace()`;
    const [profile, memberships] = await Promise.all([
      tx.profile.findUniqueOrThrow({ where: { id: profileId } }),
      tx.organizationMember.findMany({ where: { profileId }, include: { organization: true }, orderBy: { createdAt: 'asc' } })
    ]);
    return { profile, organizations: memberships.map(({ organization, role }) => ({ ...organization, role })) };
  });
  sendData(response, result);
}));

apiRouter.get('/pricing', asyncRoute(async (request, response) => {
  const profileId = userId(request);
  const pricing = await withRequestScope({ profileId }, async (tx) => Promise.all([
    tx.paymentPackage.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    tx.actionPrice.findMany({ where: { active: true }, orderBy: { action: 'asc' } })
  ]));
  sendData(response, { packages: pricing[0], actions: pricing[1] });
}));

apiRouter.get('/me/export', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request);
  const data = await withRequestScope({ profileId }, async (tx) => {
    const memberships = await tx.organizationMember.findMany({ where: { profileId }, include: { organization: true } });
    const ids = memberships.map(({ organizationId: id }) => id);
    const [sites, knowledgeSources, snapshots, opportunities, growthPrograms, growthRuns, growthActions, growthObservations, drafts, ledger, payments, auditEvents] = await Promise.all([
      tx.site.findMany({ where: { organizationId: { in: ids } }, select: { id: true, organizationId: true, name: true, domain: true, language: true, wordpressStatus: true, createdAt: true } }),
      tx.knowledgeSource.findMany({ where: { organizationId: { in: ids } } }),
      tx.dataSnapshot.findMany({ where: { organizationId: { in: ids } } }),
      tx.opportunity.findMany({ where: { organizationId: { in: ids } } }),
      tx.growthProgram.findMany({ where: { organizationId: { in: ids } } }),
      tx.growthRun.findMany({ where: { organizationId: { in: ids } }, include: { stages: true } }),
      tx.growthAction.findMany({ where: { organizationId: { in: ids } } }),
      tx.growthObservation.findMany({ where: { organizationId: { in: ids } } }),
      tx.contentDraft.findMany({ where: { organizationId: { in: ids } }, include: { reviews: true, publishAttempts: true } }),
      tx.ledgerEntry.findMany({ where: { organizationId: { in: ids } } }),
      tx.paymentIntent.findMany({ where: { organizationId: { in: ids } } }),
      tx.auditEvent.findMany({ where: { organizationId: { in: ids } }, take: 10_000 })
    ]);
    return { exportedAt: new Date().toISOString(), profile: request.authUser, organizations: memberships, sites, knowledgeSources, snapshots, opportunities, growthPrograms, growthRuns, growthActions, growthObservations, drafts, ledger, payments, auditEvents };
  });
  response.setHeader('Content-Disposition', `attachment; filename="aiseo-export-${new Date().toISOString().slice(0, 10)}.json"`);
  sendData(response, data);
}));

apiRouter.delete('/me', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request);
  const input = parseBody(z.object({ confirmEmail: z.string().email() }), request);
  if (input.confirmEmail.toLowerCase() !== request.authUser?.email?.toLowerCase()) throw new ValidationError('确认邮箱与当前账号不一致');
  idempotencyKey(request);
  if (!request.accessToken) throw new ForbiddenError('会话令牌缺失');
  await withRequestScope({ profileId }, async (tx) => { await tx.$executeRaw`SELECT private.request_account_deletion()`; });
  await revokeOwnSessions(request.accessToken);
  sendData(response, { deletionRequested: true, sessionsRevoked: true, purgeAfter: new Date(Date.now() + 30 * 86_400_000).toISOString() }, 202);
}));

apiRouter.get('/organizations', asyncRoute(async (request, response) => {
  const profileId = userId(request);
  const organizations = await withRequestScope({ profileId }, (tx) => tx.organizationMember.findMany({ where: { profileId }, include: { organization: true }, orderBy: { createdAt: 'asc' } }));
  sendData(response, organizations.map(({ organization, role }) => ({ ...organization, role })));
}));

apiRouter.get('/organizations/:organizationId/members', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request);
  const members = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    return tx.organizationMember.findMany({ where: { organizationId: orgId }, include: { profile: { select: { id: true, email: true, displayName: true } } }, orderBy: { createdAt: 'asc' } });
  });
  sendData(response, members);
}));

apiRouter.post('/organizations/:organizationId/members', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), key = idempotencyKey(request), input = parseBody(memberSchema, request);
  const outcome = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.ADMIN);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: input, execute: async () => {
      const target = await tx.profile.findUnique({ where: { id: input.profileId } });
      if (!target) throw new NotFoundError('目标用户不存在');
      const member = await tx.organizationMember.upsert({
        where: { organizationId_profileId: { organizationId: orgId, profileId: input.profileId } },
        create: { organizationId: orgId, profileId: input.profileId, role: input.role },
        update: { role: input.role }
      });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'MEMBER_UPSERTED', targetType: 'profile', targetId: input.profileId, metadata: { role: input.role } } });
      return { statusCode: 200, data: { member } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode, { traceId: request.traceId });
}));

apiRouter.get('/organizations/:organizationId/sites', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request);
  const sites = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    return tx.site.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, domain: true, language: true, wordpressStatus: true, wordpressUser: true, wordpressVerifiedAt: true, createdAt: true, integrations: { select: { id: true, provider: true, propertyId: true, status: true, lastSyncedAt: true, lastErrorCode: true, lastErrorMessage: true } } } });
  });
  sendData(response, sites);
}));

apiRouter.post('/organizations/:organizationId/sites', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), key = idempotencyKey(request), input = parseBody(siteSchema, request);
  const domainUrl = new URL(input.domain.startsWith('http') ? input.domain : `https://${input.domain}`);
  if (domainUrl.protocol !== 'https:' || domainUrl.pathname !== '/' || domainUrl.search || domainUrl.hash) throw new ValidationError('站点必须是公网 HTTPS 域名');
  const domain = domainUrl.hostname.toLowerCase();
  const outcome = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { ...input, domain }, execute: async () => {
      const site = await tx.site.create({ data: { organizationId: orgId, name: input.name, domain, language: input.language } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'SITE_CREATED', targetType: 'site', targetId: site.id } });
      return { statusCode: 201, data: { site } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.put('/organizations/:organizationId/sites/:siteId', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId), key = idempotencyKey(request), input = parseBody(siteUpdateSchema, request);
  let domain: string | undefined;
  if (input.domain) {
    const domainUrl = new URL(input.domain.startsWith('http') ? input.domain : `https://${input.domain}`);
    if (domainUrl.protocol !== 'https:' || domainUrl.pathname !== '/' || domainUrl.search || domainUrl.hash) throw new ValidationError('站点必须是公网 HTTPS 域名');
    domain = domainUrl.hostname.toLowerCase();
  }
  const outcome = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.ADMIN);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { ...input, domain }, execute: async () => {
      const existing = await tx.site.findFirst({ where: { id: siteId, organizationId: orgId } });
      if (!existing) throw new NotFoundError('站点不存在');
      const domainChanged = Boolean(domain && domain !== existing.domain);
      const site = await tx.site.update({ where: { id: siteId }, data: { name: input.name, domain, language: input.language, ...(domainChanged ? { wordpressStatus: SiteConnectionStatus.VERIFYING, wordpressVerifiedAt: null } : {}) } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'SITE_UPDATED', targetType: 'site', targetId: siteId, metadata: { fields: Object.keys(input), domainChanged } } });
      return { statusCode: 200, data: { site } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.delete('/organizations/:organizationId/sites/:siteId', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId), key = idempotencyKey(request);
  const outcome = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.OWNER);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { siteId }, execute: async () => {
      const site = await tx.site.findFirst({ where: { id: siteId, organizationId: orgId }, include: { _count: { select: { drafts: true } } } });
      if (!site) throw new NotFoundError('站点不存在');
      if (site._count.drafts > 0) throw new ConflictError('该站点已有内容与审计记录，不能直接删除；请通过账号数据删除流程处理');
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'SITE_DELETED', targetType: 'site', targetId: siteId, metadata: { domain: site.domain, name: site.name } } });
      await tx.site.delete({ where: { id: siteId } });
      return { statusCode: 200, data: { deletedId: siteId } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.post('/organizations/:organizationId/sites/:siteId/wordpress/authorize', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId), key = idempotencyKey(request);
  const site = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.ADMIN);
    const found = await tx.site.findFirst({ where: { id: siteId, organizationId: orgId } });
    if (!found) throw new NotFoundError('站点不存在');
    return found;
  });
  const endpoint = await wordPressService.applicationPasswordAuthorizationUrl(site.domain);
  const nonce = randomUUID();
  const state = signWordPressState({ organizationId: orgId, profileId, siteId, nonce, expiresAt: Date.now() + 10 * 60_000 });
  const authorizationUrl = new URL(endpoint);
  authorizationUrl.searchParams.set('app_name', 'AISEO');
  authorizationUrl.searchParams.set('app_id', site.id);
  authorizationUrl.searchParams.set('success_url', `${env.appBaseUrl}/api/v1/integrations/wordpress/callback?state=${encodeURIComponent(state)}`);
  authorizationUrl.searchParams.set('reject_url', `${env.appBaseUrl}/?wordpress=cancelled&siteId=${encodeURIComponent(siteId)}`);
  const outcome = await withRequestScope({ profileId, organizationId: orgId }, (tx) => executeIdempotent({
    tx,
    organizationId: orgId,
    profileId,
    key,
    body: { siteId },
    execute: async () => {
      await tx.idempotencyKey.create({ data: { organizationId: orgId, profileId, key: nonce, requestHash: 'wordpress-oauth-state', expiresAt: new Date(Date.now() + 10 * 60_000) } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'WORDPRESS_AUTHORIZATION_STARTED', targetType: 'site', targetId: siteId } });
      return { statusCode: 200, data: { authorizationUrl: authorizationUrl.toString(), expiresInSeconds: 600 } };
    }
  }));
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.post('/organizations/:organizationId/sites/:siteId/test-connection', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId), key = idempotencyKey(request);
  const site = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    const found = await tx.site.findFirst({ where: { id: siteId, organizationId: orgId } });
    if (!found?.wordpressCredentials) throw new ValidationError('站点尚未配置 WordPress 凭证');
    return found;
  });
  try {
    const result = await wordPressService.testConnection(site.domain, site.wordpressCredentials!);
    await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
      await tx.site.update({ where: { id: siteId }, data: { wordpressStatus: SiteConnectionStatus.CONNECTED, wordpressUser: result.user, wordpressVerifiedAt: new Date() } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'WORDPRESS_CONNECTION_VERIFIED', targetType: 'site', targetId: siteId, metadata: { idempotencyKey: key, user: result.user } } });
    });
    sendData(response, { connected: true, ...result });
  } catch (error) {
    await withRequestScope({ profileId, organizationId: orgId }, (tx) => tx.site.update({ where: { id: siteId }, data: { wordpressStatus: SiteConnectionStatus.FAILED, wordpressVerifiedAt: null } }).then(() => undefined));
    throw error;
  }
}));


apiRouter.post('/organizations/:organizationId/sites/:siteId/gsc/authorize', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId), key = idempotencyKey(request);
  const input = parseBody(z.object({ propertyId: z.string().trim().min(3).max(500) }), request);
  if (!input.propertyId.startsWith('sc-domain:') && !/^https:\/\//.test(input.propertyId)) throw new ValidationError('GSC 属性必须是 sc-domain: 或 HTTPS URL');
  const nonce = randomUUID();
  const outcome = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { siteId, ...input }, execute: async () => {
      if (!await tx.site.findFirst({ where: { id: siteId, organizationId: orgId } })) throw new NotFoundError('站点不存在');
      await tx.idempotencyKey.create({ data: { organizationId: orgId, profileId, key: nonce, requestHash: 'gsc-oauth-state', expiresAt: new Date(Date.now() + 10 * 60_000) } });
      const authorizationUrl = gscProvider.authorizationUrl(signGscState({ organizationId: orgId, profileId, siteId, propertyId: input.propertyId, nonce, expiresAt: Date.now() + 10 * 60_000 }));
      return { statusCode: 200, data: { authorizationUrl } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.post('/organizations/:organizationId/sites/:siteId/gsc/sync', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId), key = idempotencyKey(request);
  const input = parseBody(z.object({ startDate: z.string().date(), endDate: z.string().date() }), request);
  if (input.startDate > input.endDate) throw new ValidationError('GSC 开始日期不能晚于结束日期');
  const comparisonWindow = gscComparisonWindow(input.startDate, input.endDate);
  if (!comparisonWindow || comparisonWindow.periodDays < 7 || comparisonWindow.periodDays > 90) throw new ValidationError('GSC 同步窗口必须为 7 到 90 天');
  const outcome = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: input, execute: async () => {
      const connection = await tx.integrationConnection.findUnique({ where: { siteId_provider: { siteId, provider: 'GSC' } } });
      if (!connection || connection.organizationId !== orgId) throw new ConflictError('站点尚未完成 GSC 授权');
      const job = await jobService.create(tx, { organizationId: orgId, type: JobType.GSC_SYNC, idempotencyKey: key, payload: { connectionId: connection.id, ...input } });
      return { statusCode: 202, data: { job } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.delete('/organizations/:organizationId/sites/:siteId/gsc', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId);
  idempotencyKey(request);
  await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.ADMIN);
    await tx.integrationConnection.deleteMany({ where: { organizationId: orgId, siteId, provider: 'GSC' } });
    await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'GSC_DISCONNECTED', targetType: 'site', targetId: siteId } });
  });
  sendData(response, { disconnected: true });
}));

apiRouter.post('/organizations/:organizationId/sites/:siteId/growth-programs', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId), key = idempotencyKey(request);
  const input = parseBody(growthProgramSchema, request);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: input, execute: async () => {
      const site = await tx.site.findFirst({ where: { id: siteId, organizationId: orgId } });
      if (!site) throw new NotFoundError('站点不存在');
      if (site.wordpressStatus !== SiteConnectionStatus.CONNECTED || !site.wordpressVerifiedAt || !site.wordpressCredentials) {
        throw new ConflictError('请先完成 WordPress 原生授权与真实连接验证');
      }
      await assertExecutionProviders(tx);
      const created = await growthProgramService.create(tx, {
        organizationId: orgId,
        siteId,
        mode: input.mode as GrowthProgramMode,
        inputType: input.input.type as GrowthInputType,
        inputValue: input.input.value,
        occurrenceKey: key,
        budgetLimitMicros: input.budgetLimitMicros
      });
      return { statusCode: 202, data: created };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.get('/organizations/:organizationId/sites/:siteId/growth-programs', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId);
  const programs = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    if (!await tx.site.findFirst({ where: { id: siteId, organizationId: orgId } })) throw new NotFoundError('站点不存在');
    return tx.growthProgram.findMany({ where: { organizationId: orgId, siteId }, include: { runs: { orderBy: { createdAt: 'desc' }, take: 1, include: { stages: { orderBy: { createdAt: 'asc' } } } } }, orderBy: { createdAt: 'desc' } });
  });
  sendData(response, programs);
}));

apiRouter.get('/organizations/:organizationId/growth-programs/:programId', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), programId = idSchema.parse(request.params.programId);
  const program = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const found = await tx.growthProgram.findFirst({ where: { id: programId, organizationId: orgId }, include: { site: { select: { id: true, name: true, domain: true, wordpressStatus: true, integrations: { where: { provider: 'GSC' }, select: { status: true, lastSyncedAt: true }, take: 1 } } }, runs: { orderBy: { createdAt: 'desc' }, take: 20, include: { stages: { orderBy: { createdAt: 'asc' } }, actions: true } } } });
    if (!found) throw new NotFoundError('增长程序不存在');
    return found;
  });
  sendData(response, program);
}));

const changeProgramStatus = (status: GrowthProgramStatus) => asyncRoute(async (request: Request, response) => {
  const profileId = userId(request), orgId = organizationId(request), programId = idSchema.parse(request.params.programId), key = idempotencyKey(request);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { programId, status }, execute: async () => {
      const program = await tx.growthProgram.findFirst({ where: { id: programId, organizationId: orgId } });
      if (!program) throw new NotFoundError('增长程序不存在');
      if (program.mode === GrowthProgramMode.ONCE && status === GrowthProgramStatus.ACTIVE) throw new ConflictError('一次性程序不能恢复；请创建一次新的执行');
      const updated = await tx.growthProgram.update({ where: { id: programId }, data: { status, nextRunAt: status === GrowthProgramStatus.ACTIVE ? new Date() : program.nextRunAt, lockedUntil: null, lastError: null } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: status === GrowthProgramStatus.PAUSED ? 'GROWTH_PROGRAM_PAUSED' : 'GROWTH_PROGRAM_RESUMED', targetType: 'growth_program', targetId: programId } });
      return { statusCode: 200, data: { program: updated } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
});
apiRouter.post('/organizations/:organizationId/growth-programs/:programId/pause', changeProgramStatus(GrowthProgramStatus.PAUSED));
apiRouter.post('/organizations/:organizationId/growth-programs/:programId/resume', changeProgramStatus(GrowthProgramStatus.ACTIVE));

apiRouter.get('/organizations/:organizationId/growth-runs/:runId', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), runId = idSchema.parse(request.params.runId);
  const run = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const found = await tx.growthRun.findFirst({ where: { id: runId, organizationId: orgId }, include: { program: true, stages: { orderBy: { createdAt: 'asc' } }, opportunity: true, draft: { include: { reviews: true, publishAttempts: true } }, actions: { include: { observations: true } } } });
    if (!found) throw new NotFoundError('增长执行不存在');
    const gsc = await tx.integrationConnection.findFirst({ where: { organizationId: orgId, siteId: found.siteId, provider: 'GSC', status: SiteConnectionStatus.CONNECTED }, select: { lastSyncedAt: true } });
    return { ...found, measurement: { gscConnected: Boolean(gsc), lastSyncedAt: gsc?.lastSyncedAt || null, trafficClaimAllowed: Boolean(gsc) } };
  });
  sendData(response, run);
}));

apiRouter.get('/organizations/:organizationId/opportunities', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), page = cursorPage(request.query.cursor, request.query.limit);
  const result = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const rows = await tx.opportunity.findMany({ where: { organizationId: orgId }, orderBy: { id: 'asc' }, take: page.take + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
    return { rows: rows.slice(0, page.take), nextCursor: rows.length > page.take ? rows[page.take - 1].id : undefined };
  });
  sendData(response, result.rows, 200, { nextCursor: result.nextCursor });
}));

apiRouter.get('/organizations/:organizationId/jobs', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), page = cursorPage(request.query.cursor, request.query.limit);
  const result = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const rows = await tx.jobRun.findMany({ where: { organizationId: orgId }, orderBy: { id: 'asc' }, take: page.take + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
    return { rows: rows.slice(0, page.take), nextCursor: rows.length > page.take ? rows[page.take - 1].id : undefined };
  });
  sendData(response, result.rows, 200, { nextCursor: result.nextCursor });
}));

apiRouter.get('/organizations/:organizationId/jobs/:jobId', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), jobId = idSchema.parse(request.params.jobId);
  const job = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => { await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER); return jobService.get(tx, orgId, jobId); });
  sendData(response, job);
}));

apiRouter.get('/organizations/:organizationId/drafts', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request);
  const drafts = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => { await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER); return tx.contentDraft.findMany({ where: { organizationId: orgId }, include: { reviews: true, publishAttempts: true }, orderBy: { createdAt: 'desc' }, take: 100 }); });
  sendData(response, drafts);
}));

apiRouter.post('/organizations/:organizationId/drafts/:draftId/approve', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), draftId = idSchema.parse(request.params.draftId), key = idempotencyKey(request);
  const input = parseBody(z.object({ comment: z.string().trim().max(2_000).optional() }), request);
  const outcome = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { draftId, ...input }, execute: async () => {
      const draft = await tx.contentDraft.findFirst({ where: { id: draftId, organizationId: orgId }, include: { growthRuns: { include: { actions: true }, take: 1 } } });
      if (!draft) throw new NotFoundError('草稿不存在');
      if (draft.status !== DraftStatus.PENDING_REVIEW) throw new ConflictError('只有等待审核的草稿可以批准');
      const quality = draft.qualityReport as { passed?: boolean };
      const provenance = draft.dataProvenance as Array<{ status?: string; source?: string }>;
      if (!quality.passed || !Array.isArray(provenance) || provenance.length === 0 || provenance.some((item) => item.status !== 'LIVE')) throw new ConflictError('质量门禁或真实数据溯源未通过');
      await tx.draftReview.create({ data: { draftId, reviewerId: profileId, decision: ReviewDecision.APPROVED, comment: input.comment } });
      const updated = await tx.contentDraft.update({ where: { id: draftId }, data: { status: DraftStatus.APPROVED } });
      const action = draft.growthRuns[0]?.actions[0];
      if (action) await tx.growthAction.update({ where: { id: action.id }, data: { status: GrowthActionStatus.APPROVED } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'DRAFT_APPROVED', targetType: 'content_draft', targetId: draftId } });
      return { statusCode: 200, data: { draft: updated } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.post('/organizations/:organizationId/drafts/:draftId/reject', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), draftId = idSchema.parse(request.params.draftId), key = idempotencyKey(request);
  const input = parseBody(z.object({ comment: z.string().trim().min(1).max(2_000) }), request);
  const outcome = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { draftId, ...input }, execute: async () => {
      const draft = await tx.contentDraft.findFirst({ where: { id: draftId, organizationId: orgId }, include: { growthRuns: { include: { actions: true, program: true }, take: 1 } } });
      if (!draft) throw new NotFoundError('草稿不存在');
      if (draft.status !== DraftStatus.PENDING_REVIEW) throw new ConflictError('只有等待审核的草稿可以拒绝');
      await tx.draftReview.create({ data: { draftId, reviewerId: profileId, decision: ReviewDecision.REJECTED, comment: input.comment } });
      const updated = await tx.contentDraft.update({ where: { id: draftId }, data: { status: DraftStatus.REJECTED } });
      const run = draft.growthRuns[0];
      const action = run?.actions[0];
      if (action) await tx.growthAction.update({ where: { id: action.id }, data: { status: GrowthActionStatus.CANCELLED } });
      if (run) {
        await tx.growthRun.update({ where: { id: run.id }, data: { status: GrowthRunStatus.CANCELLED, finishedAt: new Date(), errorCode: 'CUSTOMER_REJECTED', errorMessage: input.comment } });
        if (run.program.mode === GrowthProgramMode.ONCE) await tx.growthProgram.update({ where: { id: run.programId }, data: { status: GrowthProgramStatus.COMPLETED, nextRunAt: null } });
      }
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'DRAFT_REJECTED', targetType: 'content_draft', targetId: draftId, metadata: { growthRunId: run?.id || null, chargedDeliverable: true } } });
      return { statusCode: 200, data: { draft: updated } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.post('/organizations/:organizationId/drafts/:draftId/publish', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request), orgId = organizationId(request), draftId = idSchema.parse(request.params.draftId), key = idempotencyKey(request);
  const outcome = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { draftId }, execute: async () => {
      const draft = await tx.contentDraft.findFirst({ where: { id: draftId, organizationId: orgId }, include: { site: true, reviews: true, growthRuns: { include: { actions: true }, take: 1 } } });
      if (!draft || draft.status !== DraftStatus.APPROVED || !draft.reviews.some((review) => review.decision === ReviewDecision.APPROVED)) throw new ConflictError('草稿尚未通过人工审批');
      if (draft.site.wordpressStatus !== SiteConnectionStatus.CONNECTED || !draft.site.wordpressCredentials) throw new ConflictError('WordPress 连接不可用');
      const run = draft.growthRuns[0];
      const action = run?.actions[0];
      if (!run || !action) throw new ConflictError('草稿未关联统一增长执行，不能进入发布队列');
      const attemptNumber = await tx.publishAttempt.count({ where: { draftId } }) + 1;
      const job = await jobService.create(tx, { organizationId: orgId, type: JobType.WORDPRESS_PUBLISH, idempotencyKey: `growth-action-publish:${action.id}`, payload: { draftId, growthRunId: run.id, actionId: action.id, automated: false } });
      const attempt = await tx.publishAttempt.findUnique({ where: { jobRunId: job.id } })
        || await tx.publishAttempt.create({ data: { organizationId: orgId, draftId, jobRunId: job.id, attemptNumber } });
      await tx.contentDraft.update({ where: { id: draftId }, data: { status: DraftStatus.PUBLISHING } });
      await tx.growthAction.update({ where: { id: action.id }, data: { status: GrowthActionStatus.EXECUTING } });
      return { statusCode: 202, data: { job, attempt } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.post('/organizations/:organizationId/drafts/:draftId/rollback', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request), orgId = organizationId(request), draftId = idSchema.parse(request.params.draftId), key = idempotencyKey(request);
  const outcome = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.ADMIN);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { draftId }, execute: async () => {
      const draft = await tx.contentDraft.findFirst({ where: { id: draftId, organizationId: orgId }, include: { growthRuns: { include: { actions: true }, take: 1 } } });
      if (!draft?.remotePostId || draft.status !== DraftStatus.PUBLISHED) throw new ConflictError('草稿没有可回滚的远端文章');
      const action = draft.growthRuns[0]?.actions[0];
      if (!action) throw new ConflictError('草稿未关联统一增长动作，不能安全回滚');
      const job = await jobService.create(tx, { organizationId: orgId, type: JobType.WORDPRESS_ROLLBACK, idempotencyKey: `growth-action-rollback:${action.id}`, payload: { draftId, actionId: action.id } });
      return { statusCode: 202, data: { job } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.post('/organizations/:organizationId/growth-actions/:actionId/approve', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request), orgId = organizationId(request), actionId = idSchema.parse(request.params.actionId), key = idempotencyKey(request);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { actionId }, execute: async () => {
      const action = await tx.growthAction.findFirst({ where: { id: actionId, organizationId: orgId }, include: { run: { include: { draft: { include: { site: true } } } } } });
      const draft = action?.run.draft;
      if (!action || !draft) throw new NotFoundError('增长动作或交付草稿不存在');
      const quality = draft.qualityReport as { passed?: boolean };
      if (!quality.passed || draft.status !== DraftStatus.PENDING_REVIEW) throw new ConflictError('草稿未通过质量门禁或已经处理');
      if (draft.site.wordpressStatus !== SiteConnectionStatus.CONNECTED || !draft.site.wordpressCredentials) throw new ConflictError('WordPress 连接不可用');
      await tx.draftReview.create({ data: { draftId: draft.id, reviewerId: profileId, decision: ReviewDecision.APPROVED } });
      const job = await jobService.create(tx, { organizationId: orgId, type: JobType.WORDPRESS_PUBLISH, idempotencyKey: `growth-action-publish:${action.id}`, payload: { draftId: draft.id, growthRunId: action.runId, actionId: action.id } });
      const attemptNumber = await tx.publishAttempt.count({ where: { draftId: draft.id } }) + 1;
      await tx.publishAttempt.create({ data: { organizationId: orgId, draftId: draft.id, jobRunId: job.id, attemptNumber } });
      await tx.contentDraft.update({ where: { id: draft.id }, data: { status: DraftStatus.PUBLISHING } });
      await tx.growthAction.update({ where: { id: action.id }, data: { status: 'EXECUTING' } });
      return { statusCode: 202, data: { actionId: action.id, draftId: draft.id, job } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.post('/organizations/:organizationId/growth-actions/:actionId/reject', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), actionId = idSchema.parse(request.params.actionId), key = idempotencyKey(request);
  const input = parseBody(z.object({ comment: z.string().trim().min(1).max(2_000) }), request);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { actionId, ...input }, execute: async () => {
      const action = await tx.growthAction.findFirst({ where: { id: actionId, organizationId: orgId }, include: { run: { include: { program: true } } } });
      if (!action?.run.draftId) throw new NotFoundError('增长动作或交付草稿不存在');
      if (action.status !== GrowthActionStatus.REVIEW_REQUIRED || action.run.status !== GrowthRunStatus.NEEDS_REVIEW) throw new ConflictError('只有等待审核的增长动作可以拒绝');
      await tx.draftReview.create({ data: { draftId: action.run.draftId, reviewerId: profileId, decision: ReviewDecision.REJECTED, comment: input.comment } });
      await tx.contentDraft.update({ where: { id: action.run.draftId }, data: { status: DraftStatus.REJECTED } });
      await tx.growthAction.update({ where: { id: action.id }, data: { status: GrowthActionStatus.CANCELLED } });
      await tx.growthRun.update({ where: { id: action.runId }, data: { status: GrowthRunStatus.CANCELLED, finishedAt: new Date(), errorCode: 'CUSTOMER_REJECTED', errorMessage: input.comment, delivery: { rejectedByCustomer: true, actionId: action.id, chargedDeliverable: true } } });
      if (action.run.program.mode === GrowthProgramMode.ONCE) await tx.growthProgram.update({ where: { id: action.run.programId }, data: { status: GrowthProgramStatus.COMPLETED, nextRunAt: null } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'GROWTH_ACTION_REJECTED', targetType: 'growth_action', targetId: action.id, metadata: { comment: input.comment, chargedDeliverable: true } } });
      return { statusCode: 200, data: { rejected: true, actionId: action.id } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.post('/organizations/:organizationId/growth-actions/:actionId/rollback', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request), orgId = organizationId(request), actionId = idSchema.parse(request.params.actionId), key = idempotencyKey(request);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.ADMIN);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { actionId }, execute: async () => {
      const action = await tx.growthAction.findFirst({ where: { id: actionId, organizationId: orgId }, include: { run: { include: { draft: true } } } });
      if (!action?.run.draft?.remotePostId || action.run.draft.status !== DraftStatus.PUBLISHED) throw new ConflictError('增长动作没有可回滚的 WordPress 版本');
      const job = await jobService.create(tx, { organizationId: orgId, type: JobType.WORDPRESS_ROLLBACK, idempotencyKey: `growth-action-rollback:${action.id}`, payload: { draftId: action.run.draft.id, actionId } });
      return { statusCode: 202, data: { job } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.get('/organizations/:organizationId/audit-events', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), page = cursorPage(request.query.cursor, request.query.limit);
  const result = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.ADMIN);
    const rows = await tx.auditEvent.findMany({ where: { organizationId: orgId }, orderBy: { id: 'asc' }, take: page.take + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
    return { rows: rows.slice(0, page.take), nextCursor: rows.length > page.take ? rows[page.take - 1].id : undefined };
  });
  sendData(response, result.rows, 200, { nextCursor: result.nextCursor });
}));

apiRouter.get('/organizations/:organizationId/metrics', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request);
  const metrics = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const [sites, liveSnapshots, openOpportunities, pendingDrafts, publishedDrafts] = await Promise.all([
      tx.site.count({ where: { organizationId: orgId } }), tx.dataSnapshot.count({ where: { organizationId: orgId, status: 'LIVE' } }), tx.opportunity.count({ where: { organizationId: orgId, status: 'OPEN' } }), tx.contentDraft.count({ where: { organizationId: orgId, status: 'PENDING_REVIEW' } }), tx.contentDraft.count({ where: { organizationId: orgId, status: 'PUBLISHED' } })
    ]);
    return { sites, liveSnapshots, openOpportunities, pendingDrafts, publishedDrafts, source: 'POSTGRES', collectedAt: new Date().toISOString() };
  });
  sendData(response, metrics);
}));

apiRouter.get('/organizations/:organizationId/payment-intents', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request);
  const intents = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => { await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER); return tx.paymentIntent.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 100 }); });
  sendData(response, intents);
}));

apiRouter.post('/organizations/:organizationId/payment-intents', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request), orgId = organizationId(request), key = idempotencyKey(request), input = parseBody(z.object({ packageId: z.string().min(1).max(80) }), request);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: input, execute: async () => ({ statusCode: 201, data: { paymentIntent: await billingService.createPaymentIntent(tx, orgId, input.packageId) } }) });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.post('/organizations/:organizationId/payment-intents/:paymentIntentId/submit-transaction', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request), orgId = organizationId(request), paymentIntentId = idSchema.parse(request.params.paymentIntentId), key = idempotencyKey(request), input = parseBody(z.object({ txHash: z.string().regex(/^[a-fA-F0-9]{64}$/) }), request);
  const outcome = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { paymentIntentId, ...input }, execute: async () => {
      const paymentIntent = await billingService.submitTransaction(tx, orgId, paymentIntentId, input.txHash);
      const job = await jobService.create(tx, { organizationId: orgId, type: JobType.PAYMENT_VERIFY, idempotencyKey: key, payload: { paymentIntentId } });
      return { statusCode: 202, data: { paymentIntent, job } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.get('/organizations/:organizationId/ledger', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), page = cursorPage(request.query.cursor, request.query.limit);
  const ledger = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const [organization, holds, entries] = await Promise.all([
      tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { creditBalanceMicros: true } }),
      tx.creditHold.aggregate({ where: { organizationId: orgId, status: 'HELD' }, _sum: { amountMicros: true } }),
      tx.ledgerEntry.findMany({ where: { organizationId: orgId }, orderBy: { id: 'asc' }, take: page.take + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) })
    ]);
    const held = holds._sum.amountMicros || 0n;
    return { balanceMicros: organization.creditBalanceMicros, heldMicros: held, availableMicros: organization.creditBalanceMicros - held, entries: entries.slice(0, page.take), nextCursor: entries.length > page.take ? entries[page.take - 1].id : undefined };
  });
  sendData(response, { balanceMicros: ledger.balanceMicros, heldMicros: ledger.heldMicros, availableMicros: ledger.availableMicros, entries: ledger.entries }, 200, { nextCursor: ledger.nextCursor });
}));

const assertPlatformAdmin = async (tx: TransactionClient, profileId: string): Promise<void> => {
  const profile = await tx.profile.findUnique({ where: { id: profileId } });
  if (profile?.platformRole !== 'PLATFORM_ADMIN' || profile.suspendedAt) throw new ForbiddenError('仅平台管理员可访问');
};

apiRouter.get('/admin/publishing-confirmation-policy', asyncRoute(async (request, response) => {
  const profileId = userId(request);
  const policy = await withRequestScope({ profileId }, async (tx) => {
    await assertPlatformAdmin(tx, profileId);
    const setting = await tx.systemSetting.findUnique({ where: { key: PUBLISH_CONFIRMATION_SETTING_KEY } });
    return parsePublishingConfirmationPolicy(setting?.value);
  });
  sendData(response, policy);
}));

apiRouter.put('/admin/publishing-confirmation-policy', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request);
  const key = idempotencyKey(request);
  const input = parseBody(z.object({ requireManualConfirmation: z.boolean() }), request);
  const policy = await withRequestScope({ profileId }, async (tx) => {
    await assertPlatformAdmin(tx, profileId);
    const value = { requireManualConfirmation: input.requireManualConfirmation };
    const setting = await tx.systemSetting.upsert({
      where: { key: PUBLISH_CONFIRMATION_SETTING_KEY },
      create: { key: PUBLISH_CONFIRMATION_SETTING_KEY, value },
      update: { value }
    });
    await tx.auditEvent.create({
      data: {
        actorId: profileId,
        action: 'PUBLISHING_CONFIRMATION_POLICY_UPDATED',
        targetType: 'system_setting',
        targetId: setting.key,
        metadata: { ...value, idempotencyKey: key }
      }
    });
    return parsePublishingConfirmationPolicy(setting.value);
  });
  sendData(response, policy);
}));

apiRouter.get('/admin/organizations', asyncRoute(async (request, response) => {
  const profileId = userId(request);
  const organizations = await withRequestScope({ profileId }, async (tx) => { await assertPlatformAdmin(tx, profileId); return tx.organization.findMany({ include: { _count: { select: { members: true, sites: true, jobs: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }); });
  sendData(response, organizations);
}));

apiRouter.get('/admin/pricing', asyncRoute(async (request, response) => {
  const profileId = userId(request);
  const pricing = await withRequestScope({ profileId }, async (tx) => { await assertPlatformAdmin(tx, profileId); return Promise.all([tx.paymentPackage.findMany({ orderBy: { sortOrder: 'asc' } }), tx.actionPrice.findMany({ orderBy: { action: 'asc' } })]); });
  sendData(response, { packages: pricing[0], actions: pricing[1] });
}));

apiRouter.put('/admin/pricing/packages/:packageId', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  idempotencyKey(request);
  const profileId = userId(request), packageId = z.string().min(1).max(80).parse(request.params.packageId);
  const input = parseBody(z.object({ name: z.string().min(1).max(100), baseAmountMicros: z.string().regex(/^\d+$/), creditMicros: z.string().regex(/^\d+$/), active: z.boolean(), sortOrder: z.number().int() }), request);
  const paymentPackage = await withRequestScope({ profileId }, async (tx) => {
    await assertPlatformAdmin(tx, profileId);
    const updated = await tx.paymentPackage.upsert({ where: { id: packageId }, create: { id: packageId, name: input.name, baseAmountMicros: BigInt(input.baseAmountMicros), creditMicros: BigInt(input.creditMicros), active: input.active, sortOrder: input.sortOrder }, update: { name: input.name, baseAmountMicros: BigInt(input.baseAmountMicros), creditMicros: BigInt(input.creditMicros), active: input.active, sortOrder: input.sortOrder } });
    await tx.auditEvent.create({ data: { actorId: profileId, action: 'PAYMENT_PACKAGE_UPDATED', targetType: 'payment_package', targetId: packageId, metadata: input } });
    return updated;
  });
  sendData(response, { paymentPackage });
}));

apiRouter.put('/admin/pricing/actions/:action', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  idempotencyKey(request);
  const profileId = userId(request), action = z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/).parse(request.params.action);
  const input = parseBody(z.object({ name: z.string().min(1).max(100), description: z.string().min(1).max(500), creditMicros: z.string().regex(/^\d+$/), active: z.boolean() }), request);
  const actionPrice = await withRequestScope({ profileId }, async (tx) => {
    await assertPlatformAdmin(tx, profileId);
    if (!await tx.actionPrice.findUnique({ where: { action } })) throw new NotFoundError('计价项不存在');
    const updated = await tx.actionPrice.update({ where: { action }, data: { name: input.name, description: input.description, creditMicros: BigInt(input.creditMicros), active: input.active } });
    await tx.auditEvent.create({ data: { actorId: profileId, action: 'ACTION_PRICE_UPDATED', targetType: 'action_price', targetId: action, metadata: input } });
    return updated;
  });
  sendData(response, { actionPrice });
}));

apiRouter.get('/admin/payments', asyncRoute(async (request, response) => {
  const profileId = userId(request);
  const payments = await withRequestScope({ profileId }, async (tx) => { await assertPlatformAdmin(tx, profileId); return tx.paymentIntent.findMany({ include: { organization: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }); });
  sendData(response, payments);
}));

apiRouter.get('/admin/usage', asyncRoute(async (request, response) => {
  const profileId = userId(request);
  const usage = await withRequestScope({ profileId }, async (tx) => { await assertPlatformAdmin(tx, profileId); return tx.usageRecord.findMany({ include: { organization: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }); });
  sendData(response, usage);
}));

apiRouter.post('/admin/organizations/:organizationId/adjustment', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request), orgId = organizationId(request), key = idempotencyKey(request);
  const input = parseBody(z.object({ amountMicros: z.string().regex(/^-?\d+$/).refine((value) => value !== '0'), reason: z.string().trim().min(10).max(500) }), request);
  const result = await withSerializableScope({ profileId }, async (tx) => {
    await assertPlatformAdmin(tx, profileId);
    const amount = BigInt(input.amountMicros);
    const organization = await tx.organization.findUnique({ where: { id: orgId } });
    if (!organization || organization.creditBalanceMicros + amount < 0n) throw new ConflictError('调整会导致负余额或组织不存在');
    const updated = await tx.organization.update({ where: { id: orgId }, data: { creditBalanceMicros: { increment: amount } } });
    const entry = await tx.ledgerEntry.create({ data: { organizationId: orgId, type: 'ADJUSTMENT', amountMicros: amount, balanceAfterMicros: updated.creditBalanceMicros, reason: input.reason, idempotencyKey: `admin-adjustment:${key}`, metadata: { actorId: profileId } } });
    await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'CREDIT_ADJUSTMENT', targetType: 'ledger_entry', targetId: entry.id, metadata: { amountMicros: input.amountMicros, reason: input.reason } } });
    return { organization: updated, entry };
  });
  sendData(response, result);
}));

apiRouter.get('/admin/provider-status', asyncRoute(async (request, response) => {
  const profileId = userId(request);
  const worker = await withRequestScope({ profileId }, async (tx) => {
    await assertPlatformAdmin(tx, profileId);
    return tx.workerHeartbeat.findFirst({ orderBy: { heartbeatAt: 'desc' } });
  });
  const { productionConfigurationStatus } = await import('./env');
  const web = productionConfigurationStatus('web').providers;
  const capabilities = worker?.capabilities && typeof worker.capabilities === 'object' && !Array.isArray(worker.capabilities) ? worker.capabilities as Record<string, unknown> : {};
  const workerOnline = Boolean(worker && worker.heartbeatAt > new Date(Date.now() - 45_000));
  sendData(response, {
    workerOnline,
    gsc: workerOnline && web.gsc && capabilities.gsc === true,
    dataForSeo: workerOnline && capabilities.dataForSeo === true,
    contentAi: workerOnline && capabilities.contentAi === true,
    trc20Payments: workerOnline && capabilities.trc20Payments === true
  });
}));
