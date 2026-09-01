import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { DraftStatus, ExecutionMode, ExecutionSourceType, GrowthCycleTrigger, GrowthStateStatus, JobType, OrganizationRole, Prisma, PublishPolicy, ReviewDecision, SiteConnectionStatus } from '@prisma/client';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../domain/errors';
import { eraseOwnAuthUser, revalidateSensitiveSession, requireAuth } from './auth';
import { billingService } from './billingService';
import { asyncRoute, cursorPage, parseBody, sendData } from './http';
import { executeIdempotent, requireIdempotencyKey } from './idempotency';
import { jobService } from './jobService';
import { withRequestScope, withSerializableScope, type TransactionClient } from './prisma';
import { currentEncryptionKeyVersion, encryptSecret } from './crypto';
import { env } from './env';
import { gscProvider } from './providers';
import { wordPressService } from './wordpress';
import { growthService } from './growthService';
import { gscComparisonWindow, readGscRows } from './growthEngine';
import { capturePublicSource } from './sourceFetcher';
import { executionService } from './executionService';
import { isValidTimezone } from './schedule';

const roleRank: Record<OrganizationRole, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2, OWNER: 3 };
const idSchema = z.string().uuid();
const languageSchema = z.enum(['zh-CN', 'en-US']);
const siteSchema = z.object({ name: z.string().trim().min(1).max(120), domain: z.string().trim().min(3).max(253), language: languageSchema.default('zh-CN') });
const siteUpdateSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), domain: z.string().trim().min(3).max(253).optional(), language: languageSchema.optional() }).refine((value) => Object.keys(value).length > 0, '至少提供一个站点字段');
const credentialSchema = z.object({ username: z.string().trim().min(1).max(200), applicationPassword: z.string().min(8).max(300) });
const memberSchema = z.object({ profileId: z.string().uuid(), role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']) });
const knowledgeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TEXT'), siteId: z.string().uuid().optional(), title: z.string().trim().min(1).max(200), content: z.string().trim().min(40).max(200_000) }),
  z.object({ type: z.literal('ORIGINAL_RESEARCH'), siteId: z.string().uuid().optional(), title: z.string().trim().min(1).max(200), content: z.string().trim().min(40).max(200_000) }),
  z.object({ type: z.literal('ALLOWLISTED_URL'), siteId: z.string().uuid().optional(), title: z.string().trim().min(1).max(200), sourceUrl: z.string().url().max(2_000) })
]);
const keywordScanSchema = z.object({ siteId: z.string().uuid(), seedKeyword: z.string().trim().min(1).max(200) });
const contentRunSchema = z.object({ siteId: z.string().uuid(), opportunityId: z.string().uuid(), knowledgeSourceIds: z.array(z.string().uuid()).min(1).max(20) });
const executionSourceSchema = z.discriminatedUnion('sourceType', [
  z.object({ sourceType: z.literal('KEYWORD'), sourceValue: z.string().trim().min(2).max(200) }),
  z.object({ sourceType: z.literal('REWRITE_URL'), sourceValue: z.string().url().max(2_000).refine((value) => value.startsWith('https://'), '二创链接必须使用 HTTPS') }),
  z.object({ sourceType: z.literal('COMPETITOR_URL'), sourceValue: z.string().url().max(2_000).refine((value) => value.startsWith('https://'), '竞品站点必须使用 HTTPS') })
]);
const automationConfigSchema = z.object({
  sourceType: z.enum(['KEYWORD', 'REWRITE_URL', 'COMPETITOR_URL']),
  sourceValue: z.string().trim().min(2).max(2_000),
  minutes: z.number().int().min(15).max(43_200).optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  timezone: z.string().trim().min(1).max(100).refine(isValidTimezone, '无效的 IANA 时区').optional()
}).superRefine((value, context) => {
  if (value.sourceType !== 'KEYWORD') {
    try {
      const url = new URL(value.sourceValue);
      if (url.protocol !== 'https:') context.addIssue({ code: 'custom', path: ['sourceValue'], message: '链接必须使用 HTTPS' });
    } catch { context.addIssue({ code: 'custom', path: ['sourceValue'], message: '请输入有效的完整链接' }); }
  }
});
const automationSchema = z.object({ siteId: z.string().uuid(), name: z.string().trim().min(1).max(120), scheduleType: z.enum(['INTERVAL', 'DAILY', 'WEEKLY']), scheduleConfig: automationConfigSchema, nextRunAt: z.string().datetime(), enabled: z.boolean().default(true) }).superRefine((value, context) => {
  if (value.scheduleType === 'INTERVAL' && !value.scheduleConfig.minutes) context.addIssue({ code: 'custom', path: ['scheduleConfig', 'minutes'], message: '间隔任务必须提供 minutes' });
  if (value.scheduleType !== 'INTERVAL' && (!value.scheduleConfig.time || !value.scheduleConfig.timezone)) context.addIssue({ code: 'custom', path: ['scheduleConfig'], message: '日历任务必须提供当地时间和 IANA 时区' });
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
    const [sites, knowledgeSources, snapshots, opportunities, drafts, ledger, payments, auditEvents] = await Promise.all([
      tx.site.findMany({ where: { organizationId: { in: ids } }, select: { id: true, organizationId: true, name: true, domain: true, language: true, wordpressStatus: true, publishPolicy: true, createdAt: true } }),
      tx.knowledgeSource.findMany({ where: { organizationId: { in: ids } } }),
      tx.dataSnapshot.findMany({ where: { organizationId: { in: ids } } }),
      tx.opportunity.findMany({ where: { organizationId: { in: ids } } }),
      tx.contentDraft.findMany({ where: { organizationId: { in: ids } }, include: { reviews: true, publishAttempts: true } }),
      tx.ledgerEntry.findMany({ where: { organizationId: { in: ids } } }),
      tx.paymentIntent.findMany({ where: { organizationId: { in: ids } } }),
      tx.auditEvent.findMany({ where: { organizationId: { in: ids } }, take: 10_000 })
    ]);
    return { exportedAt: new Date().toISOString(), profile: request.authUser, organizations: memberships, sites, knowledgeSources, snapshots, opportunities, drafts, ledger, payments, auditEvents };
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
  await eraseOwnAuthUser(request.accessToken);
  sendData(response, { deletionRequested: true, purgeAfter: new Date(Date.now() + 30 * 86_400_000).toISOString() });
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
    return tx.site.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, domain: true, language: true, wordpressStatus: true, wordpressUser: true, wordpressVerifiedAt: true, publishPolicy: true, manualPublishSuccesses: true, autoPublishTermsAcceptedAt: true, autoPublishEnabledAt: true, createdAt: true, integrations: { select: { id: true, provider: true, propertyId: true, status: true, lastSyncedAt: true, lastErrorCode: true, lastErrorMessage: true } } } });
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
      const site = await tx.site.update({ where: { id: siteId }, data: { name: input.name, domain, language: input.language, ...(domainChanged ? { wordpressStatus: SiteConnectionStatus.VERIFYING, wordpressVerifiedAt: null, publishPolicy: PublishPolicy.MANUAL_REVIEW, autoPublishEnabledAt: null } : {}) } });
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

apiRouter.put('/organizations/:organizationId/sites/:siteId/wordpress-credentials', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId), key = idempotencyKey(request), input = parseBody(credentialSchema, request);
  const outcome = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.ADMIN);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { siteId, username: input.username }, execute: async () => {
      const site = await tx.site.findFirst({ where: { id: siteId, organizationId: orgId } });
      if (!site) throw new NotFoundError('站点不存在');
      const encrypted = wordPressService.encrypt(input);
      await tx.site.update({ where: { id: siteId }, data: { wordpressCredentials: encrypted, wordpressCredentialKeyVersion: currentEncryptionKeyVersion(), wordpressStatus: SiteConnectionStatus.VERIFYING, wordpressUser: null, wordpressVerifiedAt: null, publishPolicy: PublishPolicy.MANUAL_REVIEW } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'WORDPRESS_CREDENTIALS_UPDATED', targetType: 'site', targetId: siteId } });
      return { statusCode: 200, data: { configured: true, status: SiteConnectionStatus.VERIFYING } };
    } });
  });
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

apiRouter.post('/organizations/:organizationId/sites/:siteId/auto-publish', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId), key = idempotencyKey(request);
  const input = parseBody(z.object({ enabled: z.boolean(), acceptRisk: z.boolean().default(false) }), request);
  const outcome = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.ADMIN);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: input, execute: async () => {
      const site = await tx.site.findFirst({ where: { id: siteId, organizationId: orgId } });
      if (!site) throw new NotFoundError('站点不存在');
      if (!input.enabled) {
        const updated = await tx.site.update({ where: { id: siteId }, data: { publishPolicy: PublishPolicy.MANUAL_REVIEW, autoPublishEnabledAt: null } });
        return { statusCode: 200, data: { site: updated } };
      }
      const [snapshotCount, knowledgeCount] = await Promise.all([
        tx.dataSnapshot.count({ where: { organizationId: orgId, siteId, status: 'LIVE', source: { in: ['GSC', 'DATAFORSEO'] } } }),
        tx.knowledgeSource.count({ where: { organizationId: orgId, OR: [{ siteId }, { siteId: null }], status: 'LIVE' } })
      ]);
      if (site.wordpressStatus !== SiteConnectionStatus.CONNECTED || !site.wordpressVerifiedAt) throw new ConflictError('WordPress 连接未通过验证');
      if (snapshotCount < 1 || knowledgeCount < 1) throw new ConflictError('至少需要一个真实数据源和一个知识来源');
      if (site.manualPublishSuccesses < 3) throw new ConflictError('需要连续完成 3 次人工批准并成功发布');
      if (!input.acceptRisk) throw new ConflictError('必须接受自动发布风险条款');
      const now = new Date();
      const updated = await tx.site.update({ where: { id: siteId }, data: { publishPolicy: PublishPolicy.AUTO_PUBLISH, autoPublishTermsAcceptedAt: site.autoPublishTermsAcceptedAt || now, autoPublishEnabledAt: now } });
      await tx.termsAcceptance.create({ data: { organizationId: orgId, profileId, document: 'AUTO_PUBLISH_RISK', version: '2026-08-28' } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'AUTO_PUBLISH_ENABLED', targetType: 'site', targetId: siteId } });
      return { statusCode: 200, data: { site: updated } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.post('/organizations/:organizationId/sites/:siteId/gsc/authorize', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId);
  const input = parseBody(z.object({ propertyId: z.string().trim().min(3).max(500) }), request);
  if (!input.propertyId.startsWith('sc-domain:') && !/^https:\/\//.test(input.propertyId)) throw new ValidationError('GSC 属性必须是 sc-domain: 或 HTTPS URL');
  const nonce = randomUUID();
  const url = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    if (!await tx.site.findFirst({ where: { id: siteId, organizationId: orgId } })) throw new NotFoundError('站点不存在');
    await tx.idempotencyKey.create({ data: { organizationId: orgId, profileId, key: nonce, requestHash: 'gsc-oauth-state', expiresAt: new Date(Date.now() + 10 * 60_000) } });
    return gscProvider.authorizationUrl(signGscState({ organizationId: orgId, profileId, siteId, propertyId: input.propertyId, nonce, expiresAt: Date.now() + 10 * 60_000 }));
  });
  sendData(response, { authorizationUrl: url });
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

apiRouter.post('/organizations/:organizationId/sites/:siteId/growth/start', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId), key = idempotencyKey(request);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { siteId }, execute: async () => {
      const [site, connection, knowledgeCount, latestSnapshot] = await Promise.all([
        tx.site.findFirst({ where: { id: siteId, organizationId: orgId } }),
        tx.integrationConnection.findFirst({ where: { organizationId: orgId, siteId, provider: 'GSC' } }),
        tx.knowledgeSource.count({ where: { organizationId: orgId, status: 'LIVE', OR: [{ siteId }, { siteId: null }] } }),
        tx.dataSnapshot.findFirst({ where: { organizationId: orgId, siteId, source: 'GSC', status: 'LIVE', comparisonSnapshotId: { not: null } }, orderBy: [{ periodEnd: 'desc' }, { fetchedAt: 'desc' }] })
      ]);
      if (!site) throw new NotFoundError('站点不存在');
      // Discovery and learning can safely run in observe-only mode before a
      // publishing executor exists. WordPress becomes an execution gate, not
      // an artificial prerequisite for collecting reality.
      if (!connection?.propertyId || connection.status !== SiteConnectionStatus.CONNECTED) throw new ConflictError('开始增长前必须完成 GSC 授权与连接验证');
      if (!knowledgeCount) throw new ConflictError('开始增长前必须提供至少一个真实业务知识来源');

      const state = await tx.siteGrowthState.upsert({
        where: { siteId },
        create: { organizationId: orgId, siteId, status: latestSnapshot ? GrowthStateStatus.ACTIVE : GrowthStateStatus.BASELINING },
        update: { status: latestSnapshot ? GrowthStateStatus.ACTIVE : GrowthStateStatus.BASELINING, pausedAt: null, blockedReason: null }
      });

      let cycle = null;
      let job;
      let phase: 'ANALYZING_REALITY' | 'SYNCING_REALITY';
      if (latestSnapshot) {
        const created = await growthService.createCycle(tx, { organizationId: orgId, siteId, trigger: GrowthCycleTrigger.MANUAL_START, idempotencyKey: `growth:${siteId}:${latestSnapshot.id}`, inputWatermark: latestSnapshot.fetchedAt });
        await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'SITE_GROWTH_STARTED', targetType: 'site', targetId: siteId, metadata: { cycleId: created.cycle.id, sourceSnapshotId: latestSnapshot.id } } });
        cycle = created.cycle;
        job = created.job;
        phase = 'ANALYZING_REALITY';
      } else {
        const end = new Date(Date.now() - 3 * 86_400_000);
        const start = new Date(end.getTime() - 27 * 86_400_000);
        const date = (value: Date) => value.toISOString().slice(0, 10);
        job = await jobService.create(tx, {
          organizationId: orgId,
          type: JobType.GSC_SYNC,
          idempotencyKey: `growth-baseline:${siteId}:${date(end)}`,
          payload: { connectionId: connection.id, siteId, growthBaseline: true, startDate: date(start), endDate: date(end) }
        });
        await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'SITE_GROWTH_BASELINE_REQUESTED', targetType: 'site', targetId: siteId, metadata: { syncJobId: job.id } } });
        phase = 'SYNCING_REALITY';
      }
      return { statusCode: 202, data: { state, cycle, job, phase } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.post('/organizations/:organizationId/sites/:siteId/growth/pause', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId), key = idempotencyKey(request);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { siteId }, execute: async () => {
      const state = await growthService.pause(tx, orgId, siteId);
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'SITE_GROWTH_PAUSED', targetType: 'site', targetId: siteId } });
      return { statusCode: 200, data: { state } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.get('/organizations/:organizationId/sites/:siteId/growth', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId);
  const result = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const [site, knowledgeCount, state, cycles, opportunities, actions, snapshotPair, observations] = await Promise.all([
      tx.site.findFirst({
        where: { id: siteId, organizationId: orgId },
        select: {
          wordpressStatus: true,
          wordpressVerifiedAt: true,
          integrations: { where: { provider: 'GSC' }, select: { status: true, propertyId: true }, take: 1 }
        }
      }),
      tx.knowledgeSource.count({ where: { organizationId: orgId, status: 'LIVE', OR: [{ siteId }, { siteId: null }] } }),
      tx.siteGrowthState.findUnique({ where: { siteId } }),
      tx.growthCycle.findMany({ where: { organizationId: orgId, siteId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      tx.opportunity.findMany({ where: { organizationId: orgId, siteId, status: 'OPEN', expectedValueMicros: { not: null } }, orderBy: { expectedValueMicros: 'desc' }, take: 20 }),
      tx.growthAction.findMany({ where: { organizationId: orgId, siteId }, include: { decision: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
      tx.dataSnapshot.findFirst({
        where: { organizationId: orgId, siteId, source: 'GSC', status: 'LIVE', comparisonSnapshotId: { not: null } },
        include: { comparisonSnapshot: true },
        orderBy: [{ periodEnd: 'desc' }, { fetchedAt: 'desc' }]
      }),
      tx.growthObservation.findMany({ where: { organizationId: orgId, siteId, status: 'EVALUATED' }, orderBy: { observedAt: 'desc' }, take: 100 })
    ]);
    if (!site) throw new NotFoundError('站点不存在');
    const gscConnection = site.integrations[0];
    const gscReady = gscConnection?.status === SiteConnectionStatus.CONNECTED && Boolean(gscConnection.propertyId);
    const wordpressReady = site.wordpressStatus === SiteConnectionStatus.CONNECTED && Boolean(site.wordpressVerifiedAt);
    const knowledgeReady = knowledgeCount > 0;
    const currentRows = readGscRows(snapshotPair?.payload);
    const previousRows = readGscRows(snapshotPair?.comparisonSnapshot?.payload);
    const currentClicks = currentRows.reduce((sum, row) => sum + row.clicks, 0);
    const previousClicks = previousRows.reduce((sum, row) => sum + row.clicks, 0);
    const attributedLiftMicros = observations.reduce((sum, item) => item.outcome === 'WIN' && item.estimatedLiftMicros ? sum + item.estimatedLiftMicros : sum, 0n);
    return {
      state,
      cycles,
      opportunities,
      actions,
      readiness: {
        canStart: gscReady && knowledgeReady,
        gscReady,
        knowledgeReady,
        wordpressReady,
        executionMode: wordpressReady ? 'REVIEW_GATED' : 'OBSERVE_ONLY',
        blockers: [
          ...(!gscReady ? ['GSC_CONNECTION_REQUIRED'] : []),
          ...(!knowledgeReady ? ['KNOWLEDGE_SOURCE_REQUIRED'] : [])
        ]
      },
      metrics: {
        organicClicks: currentRows.length ? currentClicks : null,
        previousOrganicClicks: previousRows.length ? previousClicks : null,
        organicClickChangePct: previousRows.length && previousClicks > 0 ? (currentClicks - previousClicks) / previousClicks * 100 : null,
        attributedLiftMicros: observations.length ? attributedLiftMicros : null,
        attributionStatus: observations.length ? 'AVAILABLE' : 'INSUFFICIENT_OBSERVATION',
        source: snapshotPair ? 'GSC' : 'UNAVAILABLE',
        collectedAt: snapshotPair?.fetchedAt || null
      }
    };
  });
  sendData(response, result);
}));

apiRouter.get('/organizations/:organizationId/knowledge-sources', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), page = cursorPage(request.query.cursor, request.query.limit);
  const result = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const rows = await tx.knowledgeSource.findMany({ where: { organizationId: orgId }, orderBy: { id: 'asc' }, take: page.take + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
    return { rows: rows.slice(0, page.take), nextCursor: rows.length > page.take ? rows[page.take - 1].id : undefined };
  });
  sendData(response, result.rows, 200, { nextCursor: result.nextCursor });
}));

apiRouter.post('/organizations/:organizationId/knowledge-sources', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), key = idempotencyKey(request), input = parseBody(knowledgeSchema, request);
  const imported = input.type === 'ALLOWLISTED_URL' ? await capturePublicSource(input.sourceUrl) : undefined;
  const content = input.type === 'ALLOWLISTED_URL' ? imported!.content : input.content;
  const checksum = createHash('sha256').update(content).digest('hex');
  const outcome = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    if (input.siteId && !await tx.site.findFirst({ where: { id: input.siteId, organizationId: orgId } })) throw new NotFoundError('站点不存在');
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: input, execute: async () => {
      const source = await tx.knowledgeSource.create({ data: { organizationId: orgId, siteId: input.siteId, type: input.type, title: input.title, sourceUrl: input.type === 'ALLOWLISTED_URL' ? input.sourceUrl : undefined, normalizedUrl: imported?.normalizedUrl, content, summary: content.slice(0, 500), checksum, fetchedAt: imported ? new Date() : undefined } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'KNOWLEDGE_SOURCE_CREATED', targetType: 'knowledge_source', targetId: source.id } });
      return { statusCode: 201, data: { source } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.get('/organizations/:organizationId/executions', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), page = cursorPage(request.query.cursor, request.query.limit);
  const result = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const rows = await tx.executionRun.findMany({
      where: { organizationId: orgId },
      include: { jobRun: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.take + 1,
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {})
    });
    return { rows: rows.slice(0, page.take), nextCursor: rows.length > page.take ? rows[page.take - 1].id : undefined };
  });
  sendData(response, result.rows, 200, { nextCursor: result.nextCursor });
}));

apiRouter.post('/organizations/:organizationId/executions', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), key = idempotencyKey(request), input = parseBody(z.object({ siteId: z.string().uuid(), source: executionSourceSchema }), request);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: input, execute: async () => {
      const site = await tx.site.findFirst({ where: { id: input.siteId, organizationId: orgId } });
      if (!site) throw new NotFoundError('站点不存在');
      if (site.wordpressStatus !== SiteConnectionStatus.CONNECTED || !site.wordpressVerifiedAt || !site.wordpressCredentials) {
        throw new ConflictError('请先完成 WordPress 凭证配置与真实连接测试');
      }
      await assertExecutionProviders(tx);
      const created = await executionService.create(tx, {
        organizationId: orgId,
        siteId: site.id,
        mode: ExecutionMode.ONCE,
        source: {
          sourceType: input.source.sourceType as ExecutionSourceType,
          sourceValue: input.source.sourceValue,
          languageCode: site.language,
          locationCode: env.defaultSeoLocationCode
        },
        occurrenceKey: key
      });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'AUTONOMOUS_EXECUTION_REQUESTED', targetType: 'execution_run', targetId: created.execution.id, metadata: { siteId: site.id, sourceType: input.source.sourceType, mode: 'ONCE', licensedSourceWarranty: input.source.sourceType === 'REWRITE_URL' } } });
      return { statusCode: 202, data: created };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.post('/organizations/:organizationId/keyword-scans', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), key = idempotencyKey(request), input = parseBody(keywordScanSchema, request);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: input, execute: async () => {
      const site = await tx.site.findFirst({ where: { id: input.siteId, organizationId: orgId } });
      if (!site) throw new NotFoundError('站点不存在');
      const scanInput = { ...input, languageCode: site.language, locationCode: env.defaultSeoLocationCode };
      const scan = await tx.keywordScan.create({ data: { organizationId: orgId, ...scanInput } });
      const job = await jobService.create(tx, { organizationId: orgId, type: JobType.DATAFORSEO_KEYWORD_SCAN, idempotencyKey: key, payload: { keywordScanId: scan.id, ...scanInput }, priceAction: 'KEYWORD_SCAN' });
      return { statusCode: 202, data: { scan, job } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
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

apiRouter.post('/organizations/:organizationId/content-runs', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), key = idempotencyKey(request), input = parseBody(contentRunSchema, request);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: input, execute: async () => {
      const opportunity = await tx.opportunity.findFirst({ where: { id: input.opportunityId, organizationId: orgId, siteId: input.siteId }, include: { snapshot: true } });
      if (!opportunity || opportunity.snapshot.status !== 'LIVE') throw new ValidationError('机会或真实 SEO 快照不可用');
      if (!opportunity.keyword) throw new ValidationError('该增长机会不是新内容机会，不能进入内容生成流程');
      const sources = await tx.knowledgeSource.findMany({ where: { id: { in: input.knowledgeSourceIds }, organizationId: orgId, status: 'LIVE', OR: [{ siteId: input.siteId }, { siteId: null }] } });
      if (sources.length !== input.knowledgeSourceIds.length) throw new ValidationError('知识来源缺失、不可用或跨组织');
      const job = await jobService.create(tx, { organizationId: orgId, type: JobType.CONTENT_GENERATION, idempotencyKey: key, payload: { ...input, seoSnapshotId: opportunity.snapshotId, keyword: opportunity.keyword }, priceAction: 'CONTENT_GENERATION' });
      return { statusCode: 202, data: { job } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
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
      const draft = await tx.contentDraft.findFirst({ where: { id: draftId, organizationId: orgId } });
      if (!draft) throw new NotFoundError('草稿不存在');
      const quality = draft.qualityReport as { passed?: boolean };
      const provenance = draft.dataProvenance as Array<{ status?: string; source?: string }>;
      if (!quality.passed || !Array.isArray(provenance) || provenance.length === 0 || provenance.some((item) => item.status !== 'LIVE')) throw new ConflictError('质量门禁或真实数据溯源未通过');
      await tx.draftReview.create({ data: { draftId, reviewerId: profileId, decision: ReviewDecision.APPROVED, comment: input.comment } });
      const updated = await tx.contentDraft.update({ where: { id: draftId }, data: { status: DraftStatus.APPROVED } });
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
      const draft = await tx.contentDraft.findFirst({ where: { id: draftId, organizationId: orgId } });
      if (!draft) throw new NotFoundError('草稿不存在');
      await tx.draftReview.create({ data: { draftId, reviewerId: profileId, decision: ReviewDecision.REJECTED, comment: input.comment } });
      const updated = await tx.contentDraft.update({ where: { id: draftId }, data: { status: DraftStatus.REJECTED } });
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
      const draft = await tx.contentDraft.findFirst({ where: { id: draftId, organizationId: orgId }, include: { site: true, reviews: true } });
      if (!draft || draft.status !== DraftStatus.APPROVED || !draft.reviews.some((review) => review.decision === ReviewDecision.APPROVED)) throw new ConflictError('草稿尚未通过人工审批');
      if (draft.site.wordpressStatus !== SiteConnectionStatus.CONNECTED || !draft.site.wordpressCredentials) throw new ConflictError('WordPress 连接不可用');
      const attemptNumber = await tx.publishAttempt.count({ where: { draftId } }) + 1;
      const job = await jobService.create(tx, { organizationId: orgId, type: JobType.WORDPRESS_PUBLISH, idempotencyKey: key, payload: { draftId } });
      const attempt = await tx.publishAttempt.create({ data: { organizationId: orgId, draftId, jobRunId: job.id, attemptNumber } });
      await tx.contentDraft.update({ where: { id: draftId }, data: { status: DraftStatus.PUBLISHING } });
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
      const draft = await tx.contentDraft.findFirst({ where: { id: draftId, organizationId: orgId } });
      if (!draft?.remotePostId || draft.status !== DraftStatus.PUBLISHED) throw new ConflictError('草稿没有可回滚的远端文章');
      const job = await jobService.create(tx, { organizationId: orgId, type: JobType.WORDPRESS_ROLLBACK, idempotencyKey: key, payload: { draftId } });
      return { statusCode: 202, data: { job } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.get('/organizations/:organizationId/automation-tasks', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request);
  const tasks = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => { await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER); return tx.automationTask.findMany({ where: { organizationId: orgId }, orderBy: { nextRunAt: 'asc' } }); });
  sendData(response, tasks);
}));

apiRouter.post('/organizations/:organizationId/automation-tasks', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), key = idempotencyKey(request), input = parseBody(automationSchema, request);
  const outcome = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.ADMIN);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: input, execute: async () => {
      const site = await tx.site.findFirst({ where: { id: input.siteId, organizationId: orgId } });
      if (!site) throw new NotFoundError('站点不存在');
      if (site.publishPolicy !== PublishPolicy.AUTO_PUBLISH) throw new ConflictError('站点通过 3 次人工发布并显式开启自动发布后，才能创建定时任务');
      if (input.enabled) await assertExecutionProviders(tx);
      const scheduleConfig = {
        ...input.scheduleConfig,
        languageCode: site.language,
        locationCode: env.defaultSeoLocationCode
      };
      const task = await tx.automationTask.create({ data: { organizationId: orgId, siteId: input.siteId, name: input.name, scheduleType: input.scheduleType, scheduleConfig: scheduleConfig as Prisma.InputJsonValue, nextRunAt: new Date(input.nextRunAt), status: input.enabled ? 'ACTIVE' : 'PAUSED' } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'AUTOMATION_TASK_CREATED', targetType: 'automation_task', targetId: task.id, metadata: { status: task.status, scheduleType: task.scheduleType, sourceType: input.scheduleConfig.sourceType, timezone: input.scheduleConfig.timezone || null } } });
      return { statusCode: 201, data: { task } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.put('/organizations/:organizationId/automation-tasks/:taskId', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), taskId = idSchema.parse(request.params.taskId), key = idempotencyKey(request);
  const input = parseBody(z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'DISABLED']), scheduleType: z.enum(['INTERVAL', 'DAILY', 'WEEKLY']).optional(), scheduleConfig: automationConfigSchema.optional(), nextRunAt: z.string().datetime().optional() }), request);
  const outcome = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.ADMIN);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: input, execute: async () => {
      const task = await tx.automationTask.findFirst({ where: { id: taskId, organizationId: orgId }, include: { site: true } });
      if (!task) throw new NotFoundError('自动任务不存在');
      if (input.status === 'ACTIVE' && task.site.publishPolicy !== PublishPolicy.AUTO_PUBLISH) throw new ConflictError('站点必须先通过自动发布门禁');
      if (input.status === 'ACTIVE') await assertExecutionProviders(tx);
      const scheduleType = input.scheduleType || task.scheduleType;
      const storedConfig = task.scheduleConfig as { sourceType?: string; sourceValue?: string; minutes?: number };
      const scheduleConfig = input.scheduleConfig
        ? { ...input.scheduleConfig, languageCode: task.site.language, locationCode: env.defaultSeoLocationCode }
        : storedConfig;
      if (scheduleType === 'INTERVAL' && !scheduleConfig.minutes) throw new ValidationError('间隔自动任务必须提供 minutes（15 至 43200）');
      if (scheduleType !== 'INTERVAL' && (!('time' in scheduleConfig) || !scheduleConfig.time || !('timezone' in scheduleConfig) || !scheduleConfig.timezone)) throw new ValidationError('日历自动任务必须提供当地时间和 IANA 时区');
      const updated = await tx.automationTask.update({ where: { id: taskId }, data: { status: input.status, scheduleType: input.scheduleType, scheduleConfig: input.scheduleConfig ? scheduleConfig as Prisma.InputJsonValue : undefined, nextRunAt: input.nextRunAt ? new Date(input.nextRunAt) : undefined, lastError: null } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'AUTOMATION_TASK_UPDATED', targetType: 'automation_task', targetId: taskId, metadata: { status: input.status } } });
      return { statusCode: 200, data: { task: updated } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.delete('/organizations/:organizationId/automation-tasks/:taskId', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), taskId = idSchema.parse(request.params.taskId), key = idempotencyKey(request);
  const outcome = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.ADMIN);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { taskId }, execute: async () => {
      const task = await tx.automationTask.findFirst({ where: { id: taskId, organizationId: orgId } });
      if (!task) throw new NotFoundError('自动任务不存在');
      await tx.automationTask.update({ where: { id: taskId }, data: { status: 'DISABLED', lockedUntil: null } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'AUTOMATION_TASK_DISABLED', targetType: 'automation_task', targetId: taskId } });
      return { statusCode: 200, data: { disabledId: taskId } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.post('/organizations/:organizationId/automation-tasks/:taskId/run', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), taskId = idSchema.parse(request.params.taskId), key = idempotencyKey(request);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.ADMIN);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { taskId }, execute: async () => {
      const task = await tx.automationTask.findFirst({ where: { id: taskId, organizationId: orgId }, include: { site: true } });
      if (!task || task.status === 'DISABLED') throw new NotFoundError('自动任务不存在');
      if (task.site.publishPolicy !== PublishPolicy.AUTO_PUBLISH) throw new ConflictError('站点必须先通过自动发布门禁');
      await assertExecutionProviders(tx);
      const config = task.scheduleConfig as { sourceType?: ExecutionSourceType; sourceValue?: string; languageCode?: string; locationCode?: number };
      if (!config.sourceType || !Object.values(ExecutionSourceType).includes(config.sourceType) || !config.sourceValue || !config.languageCode || !Number.isInteger(config.locationCode) || !config.locationCode) throw new ConflictError('自动任务配置不完整');
      const created = await executionService.create(tx, {
        organizationId: orgId,
        siteId: task.siteId,
        mode: ExecutionMode.SCHEDULED,
        source: { sourceType: config.sourceType, sourceValue: config.sourceValue, languageCode: config.languageCode, locationCode: config.locationCode },
        occurrenceKey: `manual:${key}`,
        automationTaskId: task.id
      });
      const updated = await tx.automationTask.update({ where: { id: taskId }, data: { lastRunAt: new Date(), lockedUntil: null, lastError: null } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'AUTOMATION_TASK_RUN_REQUESTED', targetType: 'execution_run', targetId: created.execution.id, metadata: { automationTaskId: task.id } } });
      return { statusCode: 202, data: { task: updated, execution: created.execution, job: created.job, queued: true } };
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
