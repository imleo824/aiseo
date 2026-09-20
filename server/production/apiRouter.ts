import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { DraftStatus, GrowthActionStatus, GrowthInputType, GrowthProgramMode, GrowthProgramStatus, GrowthRunStatus, GrowthRunTrigger, JobType, OrganizationRole, Prisma, ReviewDecision, SiteConnectionStatus } from '@prisma/client';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { ConflictError, ForbiddenError, NotFoundError, ServiceUnavailableError, ValidationError } from '../domain/errors';
import { revokeOwnSessions, revalidateSensitiveSession, requireAuth } from './auth';
import { billingService, lockOrganizationBalance } from './billingService';
import { asyncRoute, cursorPage, parseBody, sendData } from './http';
import { executeIdempotent, requireIdempotencyKey } from './idempotency';
import { jobService } from './jobService';
import { withRequestScope, withSerializableScope, type TransactionClient } from './prisma';
import { currentEncryptionKeyVersion, encryptSecret } from './crypto';
import { env } from './env';
import { gscProvider, selectGscProperty } from './providers';
import { wordPressService } from './wordpress';
import { gscComparisonWindow } from './gscData';
import { growthProgramService } from './growthProgramService';
import { parsePublishingConfirmationPolicy, PUBLISH_CONFIRMATION_SETTING_KEY } from './publishingPolicy';
import { compatibilityProfileResponse, persistWordPressCompatibility, scanWordPressCompatibility } from './wordpressCompatibility';
import { normalizeSiteDomain } from './siteDomain';
import { positiveAccountingMicrosSchema, pricingConfigurationSchema, signedAccountingMicrosSchema } from './accounting';
import { continuousCadenceDays } from './growthPolicy';

const roleRank: Record<OrganizationRole, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2, OWNER: 3 };
const idSchema = z.string().uuid();
const languageSchema = z.enum(['zh-CN', 'en-US']);
const siteSchema = z.object({ name: z.string().trim().min(1).max(120), domain: z.string().trim().min(3).max(253), language: languageSchema.default('zh-CN'), niche: z.string().trim().max(120).optional() });
const siteUpdateSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), domain: z.string().trim().min(3).max(253).optional(), language: languageSchema.optional(), niche: z.string().trim().max(120).optional() }).refine((value) => Object.keys(value).length > 0, '至少提供一个站点字段');
const memberSchema = z.object({ profileId: z.string().uuid(), role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']) });
const growthInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('KEYWORD'), value: z.string().trim().min(2).max(200) }),
  z.object({ type: z.literal('REFERENCE_URL'), value: z.string().url().max(2_000).refine((value) => /^https:\/\//i.test(value), '参考文章必须使用 HTTPS') }),
  z.object({ type: z.literal('COMPETITOR_SITE'), value: z.string().url().max(2_000).refine((value) => /^https:\/\//i.test(value), '竞品站点必须使用 HTTPS') })
]);
const growthProgramSchema = z.object({
  mode: z.enum(['ONCE', 'CONTINUOUS']),
  inputs: z.array(growthInputSchema).max(30).default([]).superRefine((inputs, context) => {
    const limits = { KEYWORD: 20, REFERENCE_URL: 5, COMPETITOR_SITE: 5 } as const;
    for (const type of Object.keys(limits) as Array<keyof typeof limits>) {
      if (inputs.filter((input) => input.type === type).length > limits[type]) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `${type} 输入数量不能超过 ${limits[type]} 个` });
      }
    }
  }),
  budgetLimitMicros: positiveAccountingMicrosSchema.transform((value) => BigInt(value)).optional()
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

const organizationFinancialSummaries = async (tx: TransactionClient, organizationIds: string[]) => {
  if (!organizationIds.length) return new Map<string, { totalRechargedMicros: bigint; totalConsumedMicros: bigint }>();
  const [payments, usage] = await Promise.all([
    tx.paymentIntent.groupBy({
      by: ['organizationId'],
      where: { organizationId: { in: organizationIds }, status: 'CREDITED' },
      _sum: { expectedAmountMicros: true }
    }),
    tx.usageRecord.groupBy({
      by: ['organizationId'],
      where: { organizationId: { in: organizationIds } },
      _sum: { amountMicros: true }
    })
  ]);
  const result = new Map(organizationIds.map((id) => [id, { totalRechargedMicros: 0n, totalConsumedMicros: 0n }]));
  for (const row of payments) result.get(row.organizationId)!.totalRechargedMicros = row._sum.expectedAmountMicros || 0n;
  for (const row of usage) result.get(row.organizationId)!.totalConsumedMicros = row._sum.amountMicros || 0n;
  return result;
};

const assertExecutionProviders = async (tx: TransactionClient): Promise<void> => {
  const heartbeat = await tx.workerHeartbeat.findFirst({ orderBy: { heartbeatAt: 'desc' } });
  const online = Boolean(heartbeat && heartbeat.heartbeatAt > new Date(Date.now() - 45_000));
  const capabilities = heartbeat?.capabilities && typeof heartbeat.capabilities === 'object' && !Array.isArray(heartbeat.capabilities)
    ? heartbeat.capabilities as Record<string, unknown>
    : {};
  if (!online) throw new ServiceUnavailableError('执行服务当前离线，请稍后重试；本次未创建任务、未扣费');
  if (capabilities.dataForSeo !== true) throw new ServiceUnavailableError('真实 SEO 数据服务当前不可用，请稍后重试；本次未创建任务、未扣费');
  if (capabilities.contentAi !== true) throw new ServiceUnavailableError('内容生成服务当前不可用，请稍后重试；本次未创建任务、未扣费');
};

const idempotencyKey = (request: Request): string => requireIdempotencyKey(request.header('idempotency-key'));

const queueWordPressPublish = async (input: {
  tx: TransactionClient;
  organizationId: string;
  draftId: string;
  runId: string;
  actionId: string;
  automated: boolean;
}) => {
  const attemptNumber = await input.tx.publishAttempt.count({ where: { draftId: input.draftId } }) + 1;
  const job = await jobService.create(input.tx, {
    organizationId: input.organizationId,
    type: JobType.WORDPRESS_PUBLISH,
    idempotencyKey: `growth-action-publish:${input.actionId}:attempt:${attemptNumber}`,
    payload: { draftId: input.draftId, growthRunId: input.runId, actionId: input.actionId, automated: input.automated }
  });
  const attempt = await input.tx.publishAttempt.create({
    data: { organizationId: input.organizationId, draftId: input.draftId, jobRunId: job.id, attemptNumber }
  });
  const draft = await input.tx.contentDraft.update({
    where: { id: input.draftId },
    data: { status: DraftStatus.PUBLISHING },
    include: { reviews: true, publishAttempts: true }
  });
  await input.tx.growthAction.update({ where: { id: input.actionId }, data: { status: GrowthActionStatus.EXECUTING } });
  await input.tx.growthRun.update({
    where: { id: input.runId },
    data: { status: GrowthRunStatus.RUNNING, currentStage: 'EXECUTE', errorCode: null, errorMessage: null, finishedAt: null }
  });
  await input.tx.growthRunStage.update({
    where: { runId_stage: { runId: input.runId, stage: 'EXECUTE' } },
    data: { status: 'RUNNING', summary: '发布任务已进入队列，等待 WordPress 写入、回读和公开页面验证。', errorCode: null, errorMessage: null, finishedAt: null }
  });
  return { draft, job, attempt };
};

const consumeOauthState = async (
  tx: TransactionClient,
  nonce: string,
  requestHash: 'gsc-oauth-state' | 'wordpress-oauth-state'
): Promise<void> => {
  const [result] = await tx.$queryRaw<Array<{ consumed: boolean }>>`
    SELECT private.consume_oauth_state(${nonce}, ${requestHash}) AS consumed
  `;
  if (!result?.consumed) throw new ConflictError('OAuth state 已使用、不存在或已过期');
};

export const apiRouter = Router();

type GscState = { organizationId: string; profileId: string; siteId: string; nonce: string; expiresAt: number };
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
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { throw new ValidationError('GSC OAuth state 格式无效'); }
  const state = z.object({ organizationId: idSchema, profileId: idSchema, siteId: idSchema, nonce: idSchema, expiresAt: z.number().int().positive() }).parse(decoded);
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
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { throw new ValidationError('WordPress OAuth state 格式无效'); }
  const state = z.object({ organizationId: idSchema, profileId: idSchema, siteId: idSchema, nonce: idSchema, expiresAt: z.number().int().positive() }).parse(decoded);
  if (state.expiresAt < Date.now()) throw new ValidationError('WordPress OAuth state 已过期');
  return state;
};

apiRouter.get('/integrations/gsc/callback', asyncRoute(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Referrer-Policy', 'no-referrer');
  const state = readGscState(String(request.query.state || ''));
  const code = String(request.query.code || '');
  if (!code) throw new ValidationError('Google 未返回授权码');
  const site = await withRequestScope({ profileId: state.profileId, organizationId: state.organizationId }, async (tx) => {
    await assertRole(tx, state.profileId, state.organizationId, OrganizationRole.EDITOR);
    await consumeOauthState(tx, state.nonce, 'gsc-oauth-state');
    const found = await tx.site.findFirst({ where: { id: state.siteId, organizationId: state.organizationId } });
    if (!found) throw new NotFoundError('站点不存在');
    return found;
  });
  const credentials = await gscProvider.exchangeCode(code);
  const propertyId = selectGscProperty(site.domain, await gscProvider.listProperties(credentials.accessToken));
  if (!propertyId) throw new ValidationError('该 Google 账号没有与当前 WordPress 域名匹配的已验证 GSC 属性');
  const storedCredentials = { refreshToken: credentials.refreshToken, scope: credentials.scope };
  await withRequestScope({ profileId: state.profileId, organizationId: state.organizationId }, async (tx) => {
    const connection = await tx.integrationConnection.upsert({ where: { siteId_provider: { siteId: state.siteId, provider: 'GSC' } }, create: { organizationId: state.organizationId, siteId: state.siteId, provider: 'GSC', propertyId, encryptedCredentials: encryptSecret(storedCredentials), keyVersion: currentEncryptionKeyVersion(), status: SiteConnectionStatus.VERIFYING }, update: { propertyId, encryptedCredentials: encryptSecret(storedCredentials), keyVersion: currentEncryptionKeyVersion(), status: SiteConnectionStatus.VERIFYING, lastErrorCode: null, lastErrorMessage: null } });
    const end = new Date(Date.now() - 3 * 86_400_000);
    const start = new Date(end.getTime() - 27 * 86_400_000);
    const date = (value: Date) => value.toISOString().slice(0, 10);
    await jobService.create(tx, {
      organizationId: state.organizationId,
      type: JobType.GSC_SYNC,
      idempotencyKey: `gsc-initial:${connection.id}:${date(end)}`,
      payload: { connectionId: connection.id, siteId: state.siteId, startDate: date(start), endDate: date(end) }
    });
    await tx.auditEvent.create({ data: { organizationId: state.organizationId, actorId: state.profileId, action: 'GSC_AUTHORIZED', targetType: 'site', targetId: state.siteId, metadata: { propertyId, initialSyncQueued: true, selection: 'AUTO_DOMAIN_MATCH' } } });
  });
  response.redirect('/?gsc=syncing');
}));

apiRouter.get('/integrations/wordpress/callback', asyncRoute(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Referrer-Policy', 'no-referrer');
  const state = readWordPressState(String(request.query.state || ''));
  const siteUrl = String(request.query.site_url || '');
  const username = String(request.query.user_login || '');
  const applicationPassword = String(request.query.password || '');
  if (!siteUrl || !username || !applicationPassword) throw new ValidationError('WordPress 未返回完整授权凭证');
  const site = await withRequestScope({ profileId: state.profileId, organizationId: state.organizationId }, async (tx) => {
    await assertRole(tx, state.profileId, state.organizationId, OrganizationRole.EDITOR);
    await consumeOauthState(tx, state.nonce, 'wordpress-oauth-state');
    const found = await tx.site.findFirst({ where: { id: state.siteId, organizationId: state.organizationId } });
    if (!found) throw new NotFoundError('站点不存在');
    const authorizedOrigin = new URL(siteUrl).origin;
    const expectedOrigin = new URL(found.domain.startsWith('https://') ? found.domain : `https://${found.domain}`).origin;
    if (authorizedOrigin !== expectedOrigin) throw new ValidationError('WordPress 授权站点与绑定站点不一致');
    return found;
  });
  const encrypted = wordPressService.encrypt({ username, applicationPassword });
  const verified = await wordPressService.testConnection(site.domain, encrypted);
  const compatibility = await scanWordPressCompatibility({ domain: site.domain, encryptedCredentials: encrypted });
  await withRequestScope({ profileId: state.profileId, organizationId: state.organizationId }, async (tx) => {
    await tx.site.update({ where: { id: state.siteId }, data: { wordpressCredentials: encrypted, wordpressCredentialKeyVersion: currentEncryptionKeyVersion(), wordpressStatus: SiteConnectionStatus.CONNECTED, wordpressUser: verified.user, wordpressVerifiedAt: new Date() } });
    const profile = await persistWordPressCompatibility(tx, { organizationId: state.organizationId, siteId: state.siteId, scan: compatibility });
    await tx.auditEvent.create({ data: { organizationId: state.organizationId, actorId: state.profileId, action: 'WORDPRESS_AUTHORIZED', targetType: 'site', targetId: state.siteId, metadata: { user: verified.user, siteName: verified.siteName, authorization: 'APPLICATION_PASSWORD_FLOW', compatibilityProfileId: profile.id, compatibilityMode: profile.mode } } });
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
    const totals = await organizationFinancialSummaries(tx, memberships.map(({ organizationId }) => organizationId));
    return {
      profile,
      organizations: memberships.map(({ organization, role }) => ({
        ...organization,
        role,
        ...(totals.get(organization.id) || { totalRechargedMicros: 0n, totalConsumedMicros: 0n })
      }))
    };
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
    const [profile, memberships, termsAcceptances, notifications] = await Promise.all([
      tx.profile.findUniqueOrThrow({
        where: { id: profileId },
        select: {
          id: true,
          email: true,
          displayName: true,
          platformRole: true,
          suspendedAt: true,
          deletionRequestedAt: true,
          createdAt: true,
          updatedAt: true
        }
      }),
      tx.organizationMember.findMany({
        where: { profileId },
        orderBy: { createdAt: 'asc' },
        select: {
          organizationId: true,
          role: true,
          createdAt: true,
          organization: { select: { name: true, disabledAt: true, createdAt: true } }
        }
      }),
      tx.termsAcceptance.findMany({
        where: { profileId },
        orderBy: { acceptedAt: 'asc' },
        select: { id: true, organizationId: true, document: true, version: true, acceptedAt: true }
      }),
      tx.notification.findMany({
        where: { profileId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, organizationId: true, type: true, title: true, message: true, status: true, createdAt: true, readAt: true }
      })
    ]);
    return {
      schemaVersion: 'personal-data-export-1',
      exportedAt: new Date().toISOString(),
      scope: 'CURRENT_PROFILE_ONLY',
      profile,
      memberships,
      termsAcceptances,
      notifications
    };
  });
  response.setHeader('Content-Disposition', `attachment; filename="tuitui-export-${new Date().toISOString().slice(0, 10)}.json"`);
  sendData(response, data);
}));

apiRouter.delete('/me', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request);
  const input = parseBody(z.object({ confirmEmail: z.string().email() }), request);
  if (input.confirmEmail.toLowerCase() !== request.authUser?.email?.toLowerCase()) throw new ValidationError('确认邮箱与当前账号不一致');
  const key = idempotencyKey(request);
  if (!request.accessToken) throw new ForbiddenError('会话令牌缺失');
  const outcome = await withSerializableScope({ profileId }, (tx) => executeIdempotent({
    tx,
    profileId,
    key,
    body: input,
    execute: async () => {
      await tx.$executeRaw`SELECT private.request_account_deletion()`;
      return { statusCode: 202, data: { deletionRequested: true, purgeAfter: new Date(Date.now() + 30 * 86_400_000).toISOString() } };
    }
  }));
  await revokeOwnSessions(request.accessToken);
  sendData(response, { ...outcome.data, sessionsRevoked: true }, outcome.statusCode);
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
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
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
  const profileId = userId(request), orgId = organizationId(request), page = cursorPage(request.query.cursor, request.query.limit);
  const result = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const rows = await tx.site.findMany({ where: { organizationId: orgId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: page.take + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}), select: { id: true, name: true, domain: true, language: true, niche: true, wordpressStatus: true, wordpressUser: true, wordpressVerifiedAt: true, wordpressCompatibilityMode: true, wordpressCompatibilityCheckedAt: true, createdAt: true, integrations: { select: { id: true, provider: true, propertyId: true, status: true, lastSyncedAt: true, lastErrorCode: true, lastErrorMessage: true } } } });
    return { rows: rows.slice(0, page.take), nextCursor: rows.length > page.take ? rows[page.take - 1].id : undefined };
  });
  sendData(response, result.rows, 200, { nextCursor: result.nextCursor });
}));

apiRouter.post('/organizations/:organizationId/sites', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), key = idempotencyKey(request), input = parseBody(siteSchema, request);
  const domain = normalizeSiteDomain(input.domain);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { ...input, domain }, execute: async () => {
      const site = await tx.site.create({ data: { organizationId: orgId, name: input.name, domain, language: input.language, niche: input.niche || null } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'SITE_CREATED', targetType: 'site', targetId: site.id } });
      return { statusCode: 201, data: { site } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.put('/organizations/:organizationId/sites/:siteId', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId), key = idempotencyKey(request), input = parseBody(siteUpdateSchema, request);
  let domain: string | undefined;
  if (input.domain) domain = normalizeSiteDomain(input.domain);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { ...input, domain }, execute: async () => {
      const existing = await tx.site.findFirst({
        where: { id: siteId, organizationId: orgId },
        include: { _count: { select: { integrations: true, growthPrograms: true, drafts: true, siteSnapshots: true, wordpressCompatibilityProfiles: true } } }
      });
      if (!existing) throw new NotFoundError('站点不存在');
      const domainChanged = Boolean(domain && domain !== existing.domain);
      const hasBoundEvidence = Boolean(
        existing.wordpressCredentials
        || existing.wordpressVerifiedAt
        || existing.wordpressStatus !== SiteConnectionStatus.NOT_CONFIGURED
        || Object.values(existing._count).some((count) => count > 0)
      );
      if (domainChanged && hasBoundEvidence) {
        throw new ConflictError('已授权或已有执行证据的站点不能改域名；请为新域名单独创建站点，避免凭证、GSC 和历史结果错误归属');
      }
      const updateData = Object.fromEntries(
        Object.entries({
          name: input.name,
          domain,
          language: input.language,
          niche: input.niche,
          ...(domainChanged ? {
            wordpressCredentials: null,
            wordpressCredentialKeyVersion: null,
            wordpressStatus: SiteConnectionStatus.NOT_CONFIGURED,
            wordpressUser: null,
            wordpressVerifiedAt: null,
            wordpressCompatibilityMode: 'RECHECK_REQUIRED',
            wordpressCompatibilityCheckedAt: null,
            latestWordpressCompatibilityProfileId: null
          } : {})
        }).filter(([, val]) => val !== undefined)
      );
      const site = await tx.site.update({ where: { id: siteId }, data: updateData });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'SITE_UPDATED', targetType: 'site', targetId: siteId, metadata: { fields: Object.keys(input), domainChanged } } });
      return { statusCode: 200, data: { site } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.delete('/organizations/:organizationId/sites/:siteId', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId), key = idempotencyKey(request);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.OWNER);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { siteId }, execute: async () => {
      const site = await tx.site.findFirst({
        where: { id: siteId, organizationId: orgId },
        include: { _count: { select: { drafts: true, wordpressCompatibilityProfiles: true } } }
      });
      if (!site) throw new NotFoundError('站点不存在');
      if (site._count.drafts > 0 || site._count.wordpressCompatibilityProfiles > 0) {
        throw new ConflictError('该站点已有内容或兼容审计记录，不能直接删除；请通过账号数据删除流程处理');
      }
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
  authorizationUrl.searchParams.set('app_name', 'TuiTui');
  authorizationUrl.searchParams.set('app_id', site.id);
  authorizationUrl.searchParams.set('success_url', `${env.appBaseUrl}/api/v1/integrations/wordpress/callback?state=${encodeURIComponent(state)}`);
  authorizationUrl.searchParams.set('reject_url', `${env.appBaseUrl}/?wordpress=cancelled&siteId=${encodeURIComponent(siteId)}`);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, (tx) => executeIdempotent({
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
    const compatibility = await scanWordPressCompatibility({ domain: site.domain, encryptedCredentials: site.wordpressCredentials! });
    const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
      await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
      return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { siteId }, execute: async () => {
        await tx.site.update({ where: { id: siteId }, data: { wordpressStatus: SiteConnectionStatus.CONNECTED, wordpressUser: result.user, wordpressVerifiedAt: new Date() } });
        const profile = await persistWordPressCompatibility(tx, { organizationId: orgId, siteId, scan: compatibility });
        await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'WORDPRESS_CONNECTION_VERIFIED', targetType: 'site', targetId: siteId, metadata: { user: result.user, compatibilityProfileId: profile.id, compatibilityMode: profile.mode } } });
        return { statusCode: 200, data: { connected: true, user: result.user, siteName: result.siteName, compatibility: compatibilityProfileResponse(profile) } };
      } });
    });
    sendData(response, outcome.data, outcome.statusCode);
  } catch (error) {
    const compatibility = await scanWordPressCompatibility({ domain: site.domain, encryptedCredentials: site.wordpressCredentials! });
    await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
      await tx.site.update({ where: { id: siteId }, data: { wordpressStatus: SiteConnectionStatus.FAILED, wordpressVerifiedAt: null } });
      await persistWordPressCompatibility(tx, { organizationId: orgId, siteId, scan: compatibility });
    });
    throw error;
  }
}));

apiRouter.get('/organizations/:organizationId/sites/:siteId/wordpress/compatibility', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId);
  const profile = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const site = await tx.site.findFirst({ where: { id: siteId, organizationId: orgId }, include: { latestWordpressCompatibilityProfile: true } });
    if (!site) throw new NotFoundError('站点不存在');
    if (!site.latestWordpressCompatibilityProfile) return { mode: site.wordpressCompatibilityMode, checkedAt: site.wordpressCompatibilityCheckedAt, profile: null };
    return { mode: site.wordpressCompatibilityMode, checkedAt: site.wordpressCompatibilityCheckedAt, profile: compatibilityProfileResponse(site.latestWordpressCompatibilityProfile) };
  });
  sendData(response, profile);
}));

apiRouter.get('/organizations/:organizationId/sites/:siteId/wordpress/action-capabilities', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId);
  const result = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const site = await tx.site.findFirst({ where: { id: siteId, organizationId: orgId }, include: { latestWordpressCompatibilityProfile: { select: { id: true, mode: true, actionCapabilities: true, blockReasons: true, checkedAt: true, expiresAt: true } } } });
    if (!site) throw new NotFoundError('站点不存在');
    return site.latestWordpressCompatibilityProfile || { mode: site.wordpressCompatibilityMode, actionCapabilities: {}, blockReasons: ['需要重新检测 WordPress 兼容能力'], checkedAt: null, expiresAt: null };
  });
  sendData(response, result);
}));

apiRouter.post('/organizations/:organizationId/sites/:siteId/wordpress/recheck', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId), key = idempotencyKey(request);
  const site = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    const found = await tx.site.findFirst({ where: { id: siteId, organizationId: orgId } });
    if (!found?.wordpressCredentials) throw new ValidationError('站点尚未完成 WordPress 官方授权');
    return found;
  });
  const compatibility = await scanWordPressCompatibility({ domain: site.domain, encryptedCredentials: site.wordpressCredentials! });
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => executeIdempotent({
    tx, organizationId: orgId, profileId, key, body: { siteId }, execute: async () => {
      const profile = await persistWordPressCompatibility(tx, { organizationId: orgId, siteId, scan: compatibility });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'WORDPRESS_COMPATIBILITY_RECHECKED', targetType: 'site', targetId: siteId, metadata: { compatibilityProfileId: profile.id, compatibilityMode: profile.mode } } });
      return { statusCode: 200, data: compatibilityProfileResponse(profile) };
    }
  }));
  sendData(response, outcome.data, outcome.statusCode);
}));


apiRouter.post('/organizations/:organizationId/sites/:siteId/gsc/authorize', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId), key = idempotencyKey(request);
  const nonce = randomUUID();
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { siteId }, execute: async () => {
      if (!await tx.site.findFirst({ where: { id: siteId, organizationId: orgId } })) throw new NotFoundError('站点不存在');
      await tx.idempotencyKey.create({ data: { organizationId: orgId, profileId, key: nonce, requestHash: 'gsc-oauth-state', expiresAt: new Date(Date.now() + 10 * 60_000) } });
      const authorizationUrl = gscProvider.authorizationUrl(signGscState({ organizationId: orgId, profileId, siteId, nonce, expiresAt: Date.now() + 10 * 60_000 }));
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
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
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
  const key = idempotencyKey(request);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.ADMIN);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { siteId }, execute: async () => {
      await tx.integrationConnection.deleteMany({ where: { organizationId: orgId, siteId, provider: 'GSC' } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'GSC_DISCONNECTED', targetType: 'site', targetId: siteId } });
      return { statusCode: 200, data: { disconnected: true } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
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
        inputs: input.inputs.map((item) => ({ type: item.type as GrowthInputType, value: item.value })),
        occurrenceKey: key,
        budgetLimitMicros: input.budgetLimitMicros
      });
      return { statusCode: 202, data: created };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.get('/organizations/:organizationId/sites/:siteId/growth-programs', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId), page = cursorPage(request.query.cursor, request.query.limit);
  const result = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    if (!await tx.site.findFirst({ where: { id: siteId, organizationId: orgId } })) throw new NotFoundError('站点不存在');
    const rows = await tx.growthProgram.findMany({ where: { organizationId: orgId, siteId }, include: { inputs: { orderBy: { position: 'asc' } }, runs: { orderBy: { createdAt: 'desc' }, take: 1, include: { stages: { orderBy: { createdAt: 'asc' } } } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: page.take + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
    return { rows: rows.slice(0, page.take), nextCursor: rows.length > page.take ? rows[page.take - 1].id : undefined };
  });
  sendData(response, result.rows, 200, { nextCursor: result.nextCursor });
}));

apiRouter.get('/organizations/:organizationId/growth-programs/:programId', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), programId = idSchema.parse(request.params.programId);
  const program = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const found = await tx.growthProgram.findFirst({ where: { id: programId, organizationId: orgId }, include: { inputs: { orderBy: { position: 'asc' } }, site: { select: { id: true, name: true, domain: true, wordpressStatus: true, integrations: { where: { provider: 'GSC' }, select: { status: true, lastSyncedAt: true }, take: 1 } } }, runs: { orderBy: { createdAt: 'desc' }, take: 20, include: { stages: { orderBy: { createdAt: 'asc' } }, action: true } } } });
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
      if (status === GrowthProgramStatus.ACTIVE) await assertExecutionProviders(tx);
      const updated = await tx.growthProgram.update({ where: { id: programId }, data: { status, nextRunAt: status === GrowthProgramStatus.ACTIVE ? new Date() : program.nextRunAt, lockedUntil: null, lastError: null }, include: { inputs: { orderBy: { position: 'asc' } } } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: status === GrowthProgramStatus.PAUSED ? 'GROWTH_PROGRAM_PAUSED' : 'GROWTH_PROGRAM_RESUMED', targetType: 'growth_program', targetId: programId } });
      return { statusCode: 200, data: { program: updated } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
});
apiRouter.post('/organizations/:organizationId/growth-programs/:programId/pause', changeProgramStatus(GrowthProgramStatus.PAUSED));
apiRouter.post('/organizations/:organizationId/growth-programs/:programId/resume', changeProgramStatus(GrowthProgramStatus.ACTIVE));

apiRouter.post('/organizations/:organizationId/growth-programs/:programId/run-now', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), programId = idSchema.parse(request.params.programId), key = idempotencyKey(request);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { programId }, execute: async () => {
      const program = await tx.growthProgram.findFirst({
        where: { id: programId, organizationId: orgId },
        include: { site: true }
      });
      if (!program) throw new NotFoundError('增长程序不存在');
      if (program.mode !== GrowthProgramMode.CONTINUOUS) throw new ConflictError('只有自动计划可以立即检查新机会');
      if (program.status !== GrowthProgramStatus.ACTIVE) throw new ConflictError('请先开启自动计划，再检查新机会');
      if (program.site.wordpressStatus !== SiteConnectionStatus.CONNECTED || !program.site.wordpressVerifiedAt || !program.site.wordpressCredentials) {
        throw new ConflictError('WordPress 连接不可用，请重新授权后再执行');
      }
      const activeRun = await tx.growthRun.findFirst({
        where: { siteId: program.siteId, status: { in: [GrowthRunStatus.QUEUED, GrowthRunStatus.RUNNING, GrowthRunStatus.NEEDS_REVIEW] } },
        select: { id: true }
      });
      if (activeRun) throw new ConflictError('该站点已有执行中或待确认的增长任务');
      await assertExecutionProviders(tx);
      const run = await growthProgramService.createScheduledRun(tx, {
        organizationId: orgId,
        programId,
        siteId: program.siteId,
        occurrenceKey: `manual:${key}`,
        trigger: GrowthRunTrigger.USER
      });
      const gscConnected = await tx.integrationConnection.count({
        where: { siteId: program.siteId, provider: 'GSC', status: SiteConnectionStatus.CONNECTED }
      }) > 0;
      const now = new Date();
      const nextRunAt = new Date(now.getTime() + continuousCadenceDays(program.consecutiveWins, gscConnected) * 86_400_000);
      const updated = await tx.growthProgram.update({
        where: { id: programId },
        data: { lastRunAt: now, nextRunAt, lockedUntil: null, lastError: null },
        include: { inputs: { orderBy: { position: 'asc' } } }
      });
      await tx.auditEvent.create({
        data: { organizationId: orgId, actorId: profileId, action: 'GROWTH_PROGRAM_RUN_REQUESTED', targetType: 'growth_program', targetId: programId, metadata: { growthRunId: run.id, nextRunAt } }
      });
      return { statusCode: 202, data: { program: updated, run } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.get('/organizations/:organizationId/sites/:siteId/growth-status', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId);
  const status = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const site = await tx.site.findFirst({ where: { id: siteId, organizationId: orgId }, select: {
      id: true,
      wordpressCompatibilityMode: true,
      wordpressCompatibilityCheckedAt: true,
      latestWordpressCompatibilityProfile: { select: { id: true, actionCapabilities: true, blockReasons: true, checkedAt: true, expiresAt: true } }
    } });
    if (!site) throw new NotFoundError('站点不存在');
    const [program, run, gsc] = await Promise.all([
      tx.growthProgram.findFirst({ where: { organizationId: orgId, siteId }, orderBy: { updatedAt: 'desc' }, include: { inputs: { orderBy: { position: 'asc' } } } }),
      tx.growthRun.findFirst({
        where: { organizationId: orgId, siteId },
        orderBy: { createdAt: 'desc' },
        include: {
          program: { include: { inputs: { orderBy: { position: 'asc' } } } },
          stages: { orderBy: { createdAt: 'asc' } },
          opportunity: true,
          siteSnapshot: { select: { id: true, status: true, sourceVersion: true, market: true, health: true, corpusChecksum: true, pageCount: true, auditedPageCount: true, fetchedAt: true } },
          draft: { select: { id: true, status: true, title: true, slug: true, qualityReport: true, publishedUrl: true, createdAt: true } },
          action: { include: { evidence: { orderBy: { createdAt: 'asc' } }, measurements: { orderBy: { windowDays: 'asc' } } } }
        }
      }),
      tx.integrationConnection.findFirst({ where: { organizationId: orgId, siteId, provider: 'GSC', status: SiteConnectionStatus.CONNECTED }, select: { lastSyncedAt: true } })
    ]);
    const activeAction = run?.action || null;
    return {
      program: run?.program || program,
      run,
      action: activeAction,
      stages: run?.stages || [],
      blocker: run?.errorCode ? { code: run.errorCode, message: run.errorMessage } : null,
      measurement: { gscConnected: Boolean(gsc), lastSyncedAt: gsc?.lastSyncedAt || null, trafficClaimAllowed: Boolean(gsc), targetUrl: activeAction?.targetUrl || run?.targetUrl || null },
      wordpressCompatibility: {
        mode: site.wordpressCompatibilityMode,
        profileId: site.latestWordpressCompatibilityProfile?.id || null,
        supportedActions: Object.entries((site.latestWordpressCompatibilityProfile?.actionCapabilities || {}) as Record<string, { supported?: boolean }>).filter(([, value]) => value.supported).map(([key]) => key),
        blockedActions: Object.entries((site.latestWordpressCompatibilityProfile?.actionCapabilities || {}) as Record<string, { supported?: boolean }>).filter(([, value]) => !value.supported).map(([key]) => key),
        fallbackReason: activeAction?.fallbackReason || null,
        blockReasons: site.latestWordpressCompatibilityProfile?.blockReasons || [],
        lastCheckedAt: site.wordpressCompatibilityCheckedAt,
        expiresAt: site.latestWordpressCompatibilityProfile?.expiresAt || null
      }
    };
  });
  sendData(response, status);
}));

apiRouter.get('/organizations/:organizationId/sites/:siteId/site-snapshots/latest', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId);
  const snapshot = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const found = await tx.siteSnapshot.findFirst({
      where: { organizationId: orgId, siteId },
      orderBy: { fetchedAt: 'desc' },
      select: {
        id: true, status: true, sourceVersion: true, market: true, health: true, corpusChecksum: true,
        pageCount: true, auditedPageCount: true, fetchedAt: true, createdAt: true
      }
    });
    if (!found) throw new NotFoundError('站点尚未完成网站理解快照');
    return found;
  });
  sendData(response, snapshot);
}));

apiRouter.get('/organizations/:organizationId/sites/:siteId/site-snapshots/:snapshotId/pages', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), siteId = idSchema.parse(request.params.siteId), snapshotId = idSchema.parse(request.params.snapshotId), page = cursorPage(request.query.cursor, request.query.limit);
  const result = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const snapshot = await tx.siteSnapshot.findFirst({ where: { id: snapshotId, organizationId: orgId, siteId }, select: { id: true } });
    if (!snapshot) throw new NotFoundError('网站快照不存在');
    const rows = await tx.sitePageSnapshot.findMany({
      where: { organizationId: orgId, siteId, snapshotId },
      orderBy: [{ url: 'asc' }, { id: 'asc' }],
      take: page.take + 1,
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
      select: { id: true, url: true, resourceType: true, status: true, modifiedAt: true, title: true, wordCount: true, contentChecksum: true, technicalEvidence: true }
    });
    return { rows: rows.slice(0, page.take), nextCursor: rows.length > page.take ? rows[page.take - 1].id : undefined };
  });
  sendData(response, result.rows, 200, { nextCursor: result.nextCursor });
}));

apiRouter.get('/organizations/:organizationId/growth-runs/:runId/candidates', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), runId = idSchema.parse(request.params.runId), page = cursorPage(request.query.cursor, request.query.limit);
  const result = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const run = await tx.growthRun.findFirst({ where: { id: runId, organizationId: orgId }, select: { id: true } });
    if (!run) throw new NotFoundError('增长执行不存在');
    const rows = await tx.growthDecision.findMany({
      where: { organizationId: orgId, runId },
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      take: page.take + 1,
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
      include: { opportunity: true, action: { select: { id: true, type: true, status: true, targetUrl: true } } }
    });
    return { rows: rows.slice(0, page.take), nextCursor: rows.length > page.take ? rows[page.take - 1].id : undefined };
  });
  sendData(response, result.rows, 200, { nextCursor: result.nextCursor });
}));

apiRouter.get('/organizations/:organizationId/growth-runs/:runId', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), runId = idSchema.parse(request.params.runId);
  const run = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const found = await tx.growthRun.findFirst({ where: { id: runId, organizationId: orgId }, include: { program: { include: { inputs: { orderBy: { position: 'asc' } } } }, stages: { orderBy: { createdAt: 'asc' } }, opportunity: true, siteSnapshot: true, draft: { include: { reviews: true, publishAttempts: true } }, action: { include: { evidence: true, pageVersions: true, measurements: { orderBy: { windowDays: 'asc' } } } } } });
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
    const rows = await tx.opportunity.findMany({ where: { organizationId: orgId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: page.take + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
    return { rows: rows.slice(0, page.take), nextCursor: rows.length > page.take ? rows[page.take - 1].id : undefined };
  });
  sendData(response, result.rows, 200, { nextCursor: result.nextCursor });
}));

apiRouter.get('/organizations/:organizationId/jobs', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), page = cursorPage(request.query.cursor, request.query.limit);
  const result = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const rows = await tx.jobRun.findMany({ where: { organizationId: orgId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: page.take + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
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
  const profileId = userId(request), orgId = organizationId(request), page = cursorPage(request.query.cursor, request.query.limit);
  const result = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const rows = await tx.contentDraft.findMany({ where: { organizationId: orgId }, include: { reviews: true, publishAttempts: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: page.take + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
    return { rows: rows.slice(0, page.take), nextCursor: rows.length > page.take ? rows[page.take - 1].id : undefined };
  });
  sendData(response, result.rows, 200, { nextCursor: result.nextCursor });
}));

apiRouter.post('/organizations/:organizationId/drafts/:draftId/approve', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request), orgId = organizationId(request), draftId = idSchema.parse(request.params.draftId), key = idempotencyKey(request);
  const input = parseBody(z.object({ comment: z.string().trim().max(2_000).optional() }), request);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { draftId, ...input }, execute: async () => {
      const draft = await tx.contentDraft.findFirst({ where: { id: draftId, organizationId: orgId }, include: { site: true, growthRun: { include: { action: true } } } });
      if (!draft) throw new NotFoundError('草稿不存在');
      if (draft.status !== DraftStatus.PENDING_REVIEW) throw new ConflictError('只有等待审核的草稿可以批准');
      const quality = draft.qualityReport as { passed?: boolean };
      const provenance = draft.dataProvenance as Array<{ status?: string; source?: string }>;
      if (!quality.passed || !Array.isArray(provenance) || provenance.length === 0 || provenance.some((item) => item.status !== 'LIVE')) throw new ConflictError('质量门禁或真实数据溯源未通过');
      if (draft.site.wordpressStatus !== SiteConnectionStatus.CONNECTED || !draft.site.wordpressCredentials) throw new ConflictError('WordPress 连接不可用');
      const run = draft.growthRun;
      const action = run?.action;
      if (!run || !action || run.status !== GrowthRunStatus.NEEDS_REVIEW || action.status !== GrowthActionStatus.REVIEW_REQUIRED) throw new ConflictError('草稿未关联等待审核的统一增长动作');
      await tx.draftReview.create({ data: { draftId, reviewerId: profileId, decision: ReviewDecision.APPROVED, comment: input.comment } });
      const queued = await queueWordPressPublish({ tx, organizationId: orgId, draftId, runId: run.id, actionId: action.id, automated: false });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'DRAFT_APPROVED_AND_QUEUED', targetType: 'content_draft', targetId: draftId, metadata: { growthRunId: run.id, growthActionId: action.id, jobRunId: queued.job.id, attemptNumber: queued.attempt.attemptNumber } } });
      return { statusCode: 202, data: queued };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.post('/organizations/:organizationId/drafts/:draftId/retry-publish', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request), orgId = organizationId(request), draftId = idSchema.parse(request.params.draftId), key = idempotencyKey(request);
  const input = parseBody(z.object({ comment: z.string().trim().max(2_000).optional() }), request);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { draftId, ...input }, execute: async () => {
      const draft = await tx.contentDraft.findFirst({
        where: { id: draftId, organizationId: orgId },
        include: { site: true, growthRun: { include: { action: true, program: true } } }
      });
      if (!draft) throw new NotFoundError('草稿不存在');
      if (draft.status !== DraftStatus.PUBLISH_FAILED) throw new ConflictError('只有发布最终失败的交付可以重新发布');
      const run = draft.growthRun;
      const action = run?.action;
      if (!run || !action || run.status !== GrowthRunStatus.FAILED || action.status !== GrowthActionStatus.FAILED) {
        throw new ConflictError('失败交付未关联可恢复的统一增长动作');
      }
      const quality = draft.qualityReport as { passed?: boolean };
      const provenance = draft.dataProvenance as Array<{ status?: string }>;
      if (!quality.passed || !Array.isArray(provenance) || provenance.length === 0 || provenance.some((item) => item.status !== 'LIVE')) {
        throw new ConflictError('质量门禁或真实数据溯源不再满足发布要求');
      }
      if (draft.site.wordpressStatus !== SiteConnectionStatus.CONNECTED || !draft.site.wordpressCredentials) {
        throw new ConflictError('WordPress 连接不可用，请重新授权后再重试');
      }
      await tx.draftReview.create({
        data: { draftId, reviewerId: profileId, decision: ReviewDecision.APPROVED, comment: input.comment || '重新发布失败交付' }
      });
      const queued = await queueWordPressPublish({ tx, organizationId: orgId, draftId, runId: run.id, actionId: action.id, automated: false });
      await tx.growthProgram.update({ where: { id: run.programId }, data: { status: GrowthProgramStatus.ACTIVE, lockedUntil: null, lastError: null } });
      await tx.auditEvent.create({
        data: { organizationId: orgId, actorId: profileId, action: 'DRAFT_PUBLISH_RETRY_QUEUED', targetType: 'content_draft', targetId: draftId, metadata: { growthRunId: run.id, growthActionId: action.id, jobRunId: queued.job.id, attemptNumber: queued.attempt.attemptNumber } }
      });
      return { statusCode: 202, data: queued };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.post('/organizations/:organizationId/drafts/:draftId/reject', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request), orgId = organizationId(request), draftId = idSchema.parse(request.params.draftId), key = idempotencyKey(request);
  const input = parseBody(z.object({ comment: z.string().trim().min(1).max(2_000) }), request);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.EDITOR);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { draftId, ...input }, execute: async () => {
      const draft = await tx.contentDraft.findFirst({ where: { id: draftId, organizationId: orgId }, include: { growthRun: { include: { action: true, program: true } } } });
      if (!draft) throw new NotFoundError('草稿不存在');
      if (draft.status !== DraftStatus.PENDING_REVIEW) throw new ConflictError('只有等待审核的草稿可以拒绝');
      const run = draft.growthRun;
      const action = run?.action;
      if (!run || !action || run.status !== GrowthRunStatus.NEEDS_REVIEW || action.status !== GrowthActionStatus.REVIEW_REQUIRED) throw new ConflictError('草稿未关联等待审核的统一增长动作');
      await tx.draftReview.create({ data: { draftId, reviewerId: profileId, decision: ReviewDecision.REJECTED, comment: input.comment } });
      const updated = await tx.contentDraft.update({
        where: { id: draftId },
        data: { status: DraftStatus.REJECTED },
        include: { reviews: true, publishAttempts: true }
      });
      await tx.growthAction.update({ where: { id: action.id }, data: { status: GrowthActionStatus.CANCELLED } });
      await tx.growthRun.update({ where: { id: run.id }, data: { status: GrowthRunStatus.CANCELLED, finishedAt: new Date(), errorCode: 'CUSTOMER_REJECTED', errorMessage: input.comment } });
      if (run.program.mode === GrowthProgramMode.ONCE) await tx.growthProgram.update({ where: { id: run.programId }, data: { status: GrowthProgramStatus.COMPLETED, nextRunAt: null } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'DRAFT_REJECTED', targetType: 'content_draft', targetId: draftId, metadata: { growthRunId: run.id, chargedDeliverable: true } } });
      return { statusCode: 200, data: { draft: updated } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.post('/organizations/:organizationId/drafts/:draftId/rollback', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request), orgId = organizationId(request), draftId = idSchema.parse(request.params.draftId), key = idempotencyKey(request);
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.ADMIN);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: { draftId }, execute: async () => {
      const draft = await tx.contentDraft.findFirst({ where: { id: draftId, organizationId: orgId }, include: { growthRun: { include: { action: true } } } });
      if (!draft?.remotePostId || draft.status !== DraftStatus.PUBLISHED) throw new ConflictError('草稿没有可回滚的远端文章');
      const action = draft.growthRun?.action;
      if (!action) throw new ConflictError('草稿未关联统一增长动作，不能安全回滚');
      const job = await jobService.create(tx, { organizationId: orgId, type: JobType.WORDPRESS_ROLLBACK, idempotencyKey: `growth-action-rollback:${action.id}:${key}`, payload: { draftId, actionId: action.id, previousActionStatus: action.status } });
      const updated = await tx.contentDraft.update({
        where: { id: draftId },
        data: { status: DraftStatus.ROLLING_BACK },
        include: { reviews: true, publishAttempts: true }
      });
      await tx.growthAction.update({ where: { id: action.id }, data: { status: GrowthActionStatus.EXECUTING } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'DRAFT_ROLLBACK_QUEUED', targetType: 'content_draft', targetId: draftId, metadata: { actionId: action.id, jobRunId: job.id } } });
      return { statusCode: 202, data: { draft: updated, job } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.get('/organizations/:organizationId/audit-events', asyncRoute(async (request, response) => {
  const profileId = userId(request), orgId = organizationId(request), page = cursorPage(request.query.cursor, request.query.limit);
  const result = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.ADMIN);
    const rows = await tx.auditEvent.findMany({ where: { organizationId: orgId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: page.take + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
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
  const profileId = userId(request), orgId = organizationId(request), page = cursorPage(request.query.cursor, request.query.limit);
  const result = await withRequestScope({ profileId, organizationId: orgId }, async (tx) => {
    await assertRole(tx, profileId, orgId, OrganizationRole.VIEWER);
    const rows = await tx.paymentIntent.findMany({ where: { organizationId: orgId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: page.take + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
    return { rows: rows.slice(0, page.take), nextCursor: rows.length > page.take ? rows[page.take - 1].id : undefined };
  });
  sendData(response, result.rows, 200, { nextCursor: result.nextCursor });
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
  const outcome = await withSerializableScope({ profileId, organizationId: orgId }, async (tx) => {
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
      tx.ledgerEntry.findMany({ where: { organizationId: orgId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: page.take + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) })
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
  const outcome = await withSerializableScope({ profileId }, async (tx) => {
    await assertPlatformAdmin(tx, profileId);
    return executeIdempotent({ tx, profileId, key, body: input, execute: async () => {
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
          metadata: value
        }
      });
      return { statusCode: 200, data: parsePublishingConfirmationPolicy(setting.value) };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.get('/admin/organizations', asyncRoute(async (request, response) => {
  const profileId = userId(request), page = cursorPage(request.query.cursor, request.query.limit);
  const result = await withRequestScope({ profileId }, async (tx) => {
    await assertPlatformAdmin(tx, profileId);
    const rows = await tx.organization.findMany({ include: { _count: { select: { members: true, sites: true, jobs: true } }, members: { where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' }, take: 1, include: { profile: { select: { email: true, displayName: true } } } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: page.take + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
    const visible = rows.slice(0, page.take);
    const totals = await organizationFinancialSummaries(tx, visible.map(({ id }) => id));
    return {
      rows: visible.map(({ members, ...organization }) => ({
        ...organization,
        owner: members[0]?.profile || null,
        ...(totals.get(organization.id) || { totalRechargedMicros: 0n, totalConsumedMicros: 0n })
      })),
      nextCursor: rows.length > page.take ? rows[page.take - 1].id : undefined
    };
  });
  sendData(response, result.rows, 200, { nextCursor: result.nextCursor });
}));

apiRouter.get('/admin/pricing', asyncRoute(async (request, response) => {
  const profileId = userId(request);
  const pricing = await withRequestScope({ profileId }, async (tx) => { await assertPlatformAdmin(tx, profileId); return Promise.all([tx.paymentPackage.findMany({ orderBy: { sortOrder: 'asc' } }), tx.actionPrice.findMany({ orderBy: { action: 'asc' } })]); });
  sendData(response, { packages: pricing[0], actions: pricing[1] });
}));

apiRouter.put('/admin/pricing', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request), key = idempotencyKey(request);
  const input = parseBody(pricingConfigurationSchema, request);
  const outcome = await withSerializableScope({ profileId }, async (tx) => {
    await assertPlatformAdmin(tx, profileId);
    return executeIdempotent({ tx, profileId, key, body: input, execute: async () => {
      const knownActions = new Set((await tx.actionPrice.findMany({ select: { action: true } })).map(({ action }) => action));
      const unknownAction = input.actions.find(({ action }) => !knownActions.has(action));
      if (unknownAction) throw new ValidationError(`计价动作不存在：${unknownAction.action}`);

      for (const item of input.packages) {
        await tx.paymentPackage.upsert({
          where: { id: item.id },
          create: { ...item, baseAmountMicros: BigInt(item.baseAmountMicros), creditMicros: BigInt(item.creditMicros) },
          update: { name: item.name, baseAmountMicros: BigInt(item.baseAmountMicros), creditMicros: BigInt(item.creditMicros), active: item.active, sortOrder: item.sortOrder }
        });
      }
      await tx.paymentPackage.updateMany({
        where: input.packages.length ? { id: { notIn: input.packages.map(({ id }) => id) }, active: true } : { active: true },
        data: { active: false }
      });
      for (const item of input.actions) {
        await tx.actionPrice.update({
          where: { action: item.action },
          data: { name: item.name, description: item.description, creditMicros: BigInt(item.creditMicros), active: item.active }
        });
      }
      await tx.actionPrice.updateMany({
        where: { action: { notIn: input.actions.map(({ action }) => action) }, active: true },
        data: { active: false }
      });
      await tx.auditEvent.create({
        data: {
          actorId: profileId,
          action: 'PRICING_CONFIGURATION_UPDATED',
          targetType: 'platform_pricing',
          targetId: 'pricing',
          metadata: input
        }
      });
      return { statusCode: 200, data: { packageCount: input.packages.length, actionCount: input.actions.length } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
}));

apiRouter.get('/admin/payments', asyncRoute(async (request, response) => {
  const profileId = userId(request), page = cursorPage(request.query.cursor, request.query.limit);
  const result = await withRequestScope({ profileId }, async (tx) => {
    await assertPlatformAdmin(tx, profileId);
    const rows = await tx.paymentIntent.findMany({ include: { organization: { select: { name: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: page.take + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
    return { rows: rows.slice(0, page.take), nextCursor: rows.length > page.take ? rows[page.take - 1].id : undefined };
  });
  sendData(response, result.rows, 200, { nextCursor: result.nextCursor });
}));

apiRouter.get('/admin/usage', asyncRoute(async (request, response) => {
  const profileId = userId(request), page = cursorPage(request.query.cursor, request.query.limit);
  const result = await withRequestScope({ profileId }, async (tx) => {
    await assertPlatformAdmin(tx, profileId);
    const rows = await tx.usageRecord.findMany({ include: { organization: { select: { name: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: page.take + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
    return { rows: rows.slice(0, page.take), nextCursor: rows.length > page.take ? rows[page.take - 1].id : undefined };
  });
  sendData(response, result.rows, 200, { nextCursor: result.nextCursor });
}));

apiRouter.post('/admin/organizations/:organizationId/adjustment', asyncRoute(async (request, response) => {
  await revalidateSensitiveSession(request);
  const profileId = userId(request), orgId = organizationId(request), key = idempotencyKey(request);
  const input = parseBody(z.object({ amountMicros: signedAccountingMicrosSchema, reason: z.string().trim().min(10).max(500) }), request);
  const outcome = await withSerializableScope({ profileId }, async (tx) => {
    await assertPlatformAdmin(tx, profileId);
    return executeIdempotent({ tx, organizationId: orgId, profileId, key, body: input, execute: async () => {
      const amount = BigInt(input.amountMicros);
      const organization = await lockOrganizationBalance(tx, orgId);
      if (!organization || organization.creditBalanceMicros + amount < 0n) throw new ConflictError('调整会导致负余额或组织不存在');
      const updated = await tx.organization.update({ where: { id: orgId }, data: { creditBalanceMicros: { increment: amount } } });
      const entry = await tx.ledgerEntry.create({ data: { organizationId: orgId, type: 'ADJUSTMENT', amountMicros: amount, balanceAfterMicros: updated.creditBalanceMicros, reason: input.reason, idempotencyKey: `admin-adjustment:${key}`, metadata: { actorId: profileId } } });
      await tx.auditEvent.create({ data: { organizationId: orgId, actorId: profileId, action: 'CREDIT_ADJUSTMENT', targetType: 'ledger_entry', targetId: entry.id, metadata: { amountMicros: input.amountMicros, reason: input.reason } } });
      return { statusCode: 200, data: { organization: updated, entry } };
    } });
  });
  sendData(response, outcome.data, outcome.statusCode);
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
