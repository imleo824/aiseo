import { Router, type NextFunction, type Request, type Response } from 'express';
import { DataSource, DataStatus, JobType, OrganizationRole, DraftStatus } from '@prisma/client';
import { AppError, NotFoundError, ValidationError } from '../domain/errors';
import { billingService } from './billingService';
import { type DataProvenance, isProductionDataStatus, type QualityReport } from './contracts';
import { env } from './env';
import { requireIdempotencyKey, replayOrExecute } from './idempotency';
import { jobService } from './jobService';
import { gscProvider, signGscState, verifyGscState, wordPressProvider } from './providers';
import { prisma } from './prisma';
import { type AuthenticatedUser, sessionService } from './sessionService';

type V1Request = Request & { authUser?: AuthenticatedUser };
type Handler = (req: V1Request, res: Response) => Promise<void>;

const asyncRoute = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => void handler(req as V1Request, res).catch(next);
const getToken = (req: Request): string | undefined => {
  const cookieToken = req.headers.cookie?.match(/(?:^|;\s*)seo_session=([^;]+)/)?.[1];
  return cookieToken || req.headers.authorization?.replace(/^Bearer\s+/i, '');
};
const setSessionCookie = (res: Response, token: string) => res.cookie('seo_session', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: env.sessionHours * 60 * 60 * 1000 });
const clearSessionCookie = (res: Response) => res.clearCookie('seo_session', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
const requireAuth = async (req: V1Request): Promise<AuthenticatedUser> => {
  const user = await sessionService.resolve(getToken(req));
  req.authUser = user;
  return user;
};
const organizationId = (req: Request) => {
  const value = req.params.organizationId;
  if (!value) throw new ValidationError('缺少 organizationId');
  return value;
};
const requireOrganization = async (req: V1Request, allowed: OrganizationRole[] = [OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.EDITOR, OrganizationRole.VIEWER]) => {
  const user = await requireAuth(req);
  const id = organizationId(req);
  sessionService.assertOrganizationRole(user, id, allowed);
  return { user, organizationId: id };
};
const headerIdempotencyKey = (req: Request) => requireIdempotencyKey(req.header('idempotency-key'));
const roleForWrite = [OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.EDITOR];
const isSafeDomain = (domain: string) => /^[a-z0-9.-]+$/i.test(domain) && !domain.includes('..') && domain.length <= 253;

export const apiV1Router = Router();

apiV1Router.post('/auth/register', asyncRoute(async (req, res) => {
  const { email, username, password, organizationName } = req.body || {};
  const result = await sessionService.register({ email: String(email || ''), username: String(username || ''), password: String(password || ''), organizationName: String(organizationName || '') });
  setSessionCookie(res, result.token);
  res.status(201).json({ user: result.user });
}));
apiV1Router.post('/auth/login', asyncRoute(async (req, res) => {
  const result = await sessionService.login(String(req.body?.identifier || ''), String(req.body?.password || ''));
  setSessionCookie(res, result.token);
  res.json({ user: result.user });
}));
apiV1Router.post('/auth/logout', asyncRoute(async (req, res) => {
  await sessionService.revoke(getToken(req));
  clearSessionCookie(res);
  res.status(204).end();
}));
apiV1Router.get('/auth/me', asyncRoute(async (req, res) => {
  res.json({ user: await requireAuth(req) });
}));

apiV1Router.get('/organizations', asyncRoute(async (req, res) => {
  res.json({ organizations: (await requireAuth(req)).organizations });
}));
apiV1Router.get('/organizations/:organizationId/members', asyncRoute(async (req, res) => {
  const { organizationId: id } = await requireOrganization(req);
  const members = await prisma.organizationMember.findMany({ where: { organizationId: id }, include: { user: { select: { id: true, email: true, username: true } } }, orderBy: { createdAt: 'asc' } });
  res.json({ members: members.map(({ user, role, createdAt }) => ({ ...user, role, createdAt })) });
}));
apiV1Router.post('/organizations/:organizationId/members', asyncRoute(async (req, res) => {
  const { user, organizationId: id } = await requireOrganization(req, [OrganizationRole.OWNER, OrganizationRole.ADMIN]);
  const key = headerIdempotencyKey(req);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const role = req.body?.role as OrganizationRole;
  if (!email || !Object.values(OrganizationRole).includes(role) || role === OrganizationRole.OWNER) throw new ValidationError('成员邮箱或角色无效');
  const result = await replayOrExecute({ organizationId: id, userId: user.id, key, body: req.body, execute: async () => {
    const target = await prisma.user.findUnique({ where: { email } });
    if (!target) throw new NotFoundError('受邀用户尚未注册');
    const membership = await prisma.organizationMember.upsert({ where: { organizationId_userId: { organizationId: id, userId: target.id } }, create: { organizationId: id, userId: target.id, role }, update: { role } });
    await prisma.auditEvent.create({ data: { organizationId: id, actorId: user.id, action: 'MEMBER_UPSERTED', targetType: 'user', targetId: target.id, metadata: { role } } });
    return { statusCode: 200, response: { member: { userId: target.id, role: membership.role } } };
  } });
  res.status(result.statusCode).json(result.response);
}));

apiV1Router.post('/organizations/:organizationId/sites', asyncRoute(async (req, res) => {
  const { user, organizationId: id } = await requireOrganization(req, roleForWrite);
  const key = headerIdempotencyKey(req);
  const domain = String(req.body?.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const name = String(req.body?.name || '').trim();
  const language = String(req.body?.language || 'zh-CN');
  const credentials = req.body?.wordpressCredentials as { username?: string; applicationPassword?: string } | undefined;
  if (!isSafeDomain(domain) || !name) throw new ValidationError('站点域名或名称无效');
  const result = await replayOrExecute({ organizationId: id, userId: user.id, key, body: req.body, execute: async () => {
    const site = await prisma.site.create({ data: { organizationId: id, domain, name, language, wordpressCredentials: credentials ? wordPressProvider.encryptCredentials({ username: String(credentials.username || ''), applicationPassword: String(credentials.applicationPassword || '') }) : undefined } });
    await prisma.auditEvent.create({ data: { organizationId: id, actorId: user.id, action: 'SITE_CREATED', targetType: 'site', targetId: site.id } });
    return { statusCode: 201, response: { site: { id: site.id, domain: site.domain, name: site.name, language: site.language, wordpressConfigured: Boolean(site.wordpressCredentials) } } };
  } });
  res.status(result.statusCode).json(result.response);
}));
apiV1Router.get('/organizations/:organizationId/sites', asyncRoute(async (req, res) => {
  const { organizationId: id } = await requireOrganization(req);
  const sites = await prisma.site.findMany({ where: { organizationId: id }, orderBy: { createdAt: 'desc' }, select: { id: true, domain: true, name: true, language: true, createdAt: true, wordpressCredentials: true } });
  res.json({ sites: sites.map(({ wordpressCredentials, ...site }) => ({ ...site, wordpressConfigured: Boolean(wordpressCredentials) })) });
}));

apiV1Router.get('/organizations/:organizationId/integrations/gsc/authorize', asyncRoute(async (req, res) => {
  const { user, organizationId: id } = await requireOrganization(req, roleForWrite);
  const siteUrl = String(req.query.siteUrl || '').trim();
  if (!/^https?:\/\//.test(siteUrl) && !siteUrl.startsWith('sc-domain:')) throw new ValidationError('siteUrl 必须为 GSC 属性 URL 或 sc-domain 属性');
  res.json({ authorizationUrl: gscProvider.authorizationUrl(signGscState({ organizationId: id, userId: user.id, siteUrl })) });
}));
apiV1Router.get('/integrations/gsc/callback', asyncRoute(async (req, res) => {
  const state = verifyGscState(String(req.query.state || ''));
  const user = await requireAuth(req);
  if (user.id !== state.userId) throw new ValidationError('GSC 回调会话与发起授权的用户不一致');
  // OAuth state can remain valid for several minutes. Re-check the current
  // membership and write role so a user removed or downgraded after starting
  // authorization cannot attach a GSC connection to the organization.
  sessionService.assertOrganizationRole(user, state.organizationId, roleForWrite);
  const code = String(req.query.code || '');
  if (!code) throw new ValidationError('GSC 未返回授权码');
  const credentials = await gscProvider.exchangeCode(code, state.siteUrl);
  await gscProvider.storeConnection(state.organizationId, credentials);
  res.redirect('/?gsc=connected');
}));
apiV1Router.post('/organizations/:organizationId/integrations/gsc/sync', asyncRoute(async (req, res) => {
  const { user, organizationId: id } = await requireOrganization(req, roleForWrite);
  const key = headerIdempotencyKey(req);
  const result = await replayOrExecute({ organizationId: id, userId: user.id, key, body: req.body, execute: async () => ({ statusCode: 202, response: { job: await jobService.enqueue({ organizationId: id, type: JobType.GSC_SYNC, payload: {}, idempotencyKey: key }) } }) });
  res.status(result.statusCode).json(result.response);
}));

apiV1Router.post('/organizations/:organizationId/serp-tasks', asyncRoute(async (req, res) => {
  const { user, organizationId: id } = await requireOrganization(req, roleForWrite);
  const key = headerIdempotencyKey(req);
  const keyword = String(req.body?.keyword || '').trim();
  const locationCode = Number(req.body?.locationCode);
  const languageCode = String(req.body?.languageCode || '').trim();
  const siteId = req.body?.siteId ? String(req.body.siteId) : undefined;
  if (!keyword || !Number.isInteger(locationCode) || !languageCode) throw new ValidationError('关键词、locationCode 或 languageCode 无效');
  if (siteId && !await prisma.site.findFirst({ where: { id: siteId, organizationId: id }, select: { id: true } })) throw new NotFoundError('站点不存在');
  const payload = { keyword, locationCode, languageCode, siteId };
  const result = await replayOrExecute({ organizationId: id, userId: user.id, key, body: payload, execute: async () => ({ statusCode: 202, response: { job: await jobService.enqueue({ organizationId: id, type: JobType.DATAFORSEO_SERP, payload, idempotencyKey: key, reserveCredits: jobService.dataForSeoCreditCost() }) } }) });
  res.status(result.statusCode).json(result.response);
}));

apiV1Router.post('/organizations/:organizationId/content-tasks', asyncRoute(async (req, res) => {
  const { user, organizationId: id } = await requireOrganization(req, roleForWrite);
  const key = headerIdempotencyKey(req);
  const siteId = String(req.body?.siteId || '');
  const keyword = String(req.body?.keyword || '').trim();
  const language = String(req.body?.language || 'zh-CN');
  const dataSnapshotIds = Array.isArray(req.body?.dataSnapshotIds) ? req.body.dataSnapshotIds.map(String) : [];
  if (!siteId || !keyword || !dataSnapshotIds.length) throw new ValidationError('内容任务必须指定站点、关键词和真实数据快照');
  const [site, snapshotCount] = await Promise.all([prisma.site.findFirst({ where: { id: siteId, organizationId: id }, select: { id: true } }), prisma.dataSnapshot.count({ where: { id: { in: dataSnapshotIds }, organizationId: id, status: DataStatus.LIVE } })]);
  if (!site || snapshotCount !== dataSnapshotIds.length) throw new ValidationError('站点或数据快照无效；生产内容不得使用模拟数据');
  const payload = { siteId, keyword, language, dataSnapshotIds };
  const result = await replayOrExecute({ organizationId: id, userId: user.id, key, body: payload, execute: async () => ({ statusCode: 202, response: { job: await jobService.enqueue({ organizationId: id, type: JobType.CONTENT_GENERATION, payload, idempotencyKey: key }) } }) });
  res.status(result.statusCode).json(result.response);
}));

apiV1Router.get('/organizations/:organizationId/jobs/:jobId', asyncRoute(async (req, res) => {
  const { organizationId: id } = await requireOrganization(req);
  const job = await jobService.get(id, req.params.jobId);
  res.json({ job });
}));
apiV1Router.get('/organizations/:organizationId/data-snapshots', asyncRoute(async (req, res) => {
  const { organizationId: id } = await requireOrganization(req);
  const source = req.query.source ? String(req.query.source) as DataSource : undefined;
  const snapshots = await prisma.dataSnapshot.findMany({ where: { organizationId: id, ...(source ? { source } : {}) }, orderBy: { fetchedAt: 'desc' }, take: 100 });
  const data = snapshots.map((snapshot) => ({ id: snapshot.id, payload: snapshot.payload, provenance: { source: snapshot.source, status: snapshot.status, fetchedAt: snapshot.fetchedAt.toISOString(), providerTaskId: snapshot.providerTaskId || undefined, availableFrom: snapshot.availableFrom?.toISOString() } satisfies DataProvenance }));
  res.json({ snapshots: data });
}));

apiV1Router.post('/organizations/:organizationId/payment-intents', asyncRoute(async (req, res) => {
  const { user, organizationId: id } = await requireOrganization(req, roleForWrite);
  const key = headerIdempotencyKey(req);
  const result = await replayOrExecute({ organizationId: id, userId: user.id, key, body: req.body, execute: async () => ({ statusCode: 201, response: { paymentIntent: await billingService.createPaymentIntent(id, req.body?.amountUsdt) } }) });
  res.status(result.statusCode).json(result.response);
}));
apiV1Router.post('/organizations/:organizationId/payment-intents/:paymentIntentId/transaction', asyncRoute(async (req, res) => {
  const { user, organizationId: id } = await requireOrganization(req, roleForWrite);
  const key = headerIdempotencyKey(req);
  const txHash = String(req.body?.txHash || '');
  const paymentIntentId = req.params.paymentIntentId;
  const result = await replayOrExecute({ organizationId: id, userId: user.id, key, body: { txHash, paymentIntentId }, execute: async () => {
    await billingService.attachTransactionHash(id, paymentIntentId, txHash);
    return { statusCode: 202, response: { job: await jobService.enqueue({ organizationId: id, type: JobType.PAYMENT_VERIFY, payload: { paymentIntentId }, idempotencyKey: key }) } };
  } });
  res.status(result.statusCode).json(result.response);
}));
apiV1Router.get('/organizations/:organizationId/ledger', asyncRoute(async (req, res) => {
  const { organizationId: id } = await requireOrganization(req);
  const [organization, entries, holds] = await Promise.all([prisma.organization.findUniqueOrThrow({ where: { id }, select: { creditBalance: true } }), prisma.ledgerEntry.findMany({ where: { organizationId: id }, orderBy: { createdAt: 'desc' }, take: 200 }), prisma.creditHold.aggregate({ where: { organizationId: id, status: 'HELD' }, _sum: { amount: true } })]);
  res.json({ balance: organization.creditBalance, held: holds._sum.amount || 0, available: organization.creditBalance - (holds._sum.amount || 0), entries });
}));

apiV1Router.get('/organizations/:organizationId/drafts', asyncRoute(async (req, res) => {
  const { organizationId: id } = await requireOrganization(req);
  const drafts = await prisma.contentDraft.findMany({ where: { organizationId: id }, include: { approvals: true }, orderBy: { createdAt: 'desc' } });
  res.json({ drafts });
}));
apiV1Router.post('/organizations/:organizationId/drafts/:draftId/approve', asyncRoute(async (req, res) => {
  const { user, organizationId: id } = await requireOrganization(req, roleForWrite);
  const key = headerIdempotencyKey(req);
  const draftId = req.params.draftId;
  const result = await replayOrExecute({ organizationId: id, userId: user.id, key, body: { draftId, comment: req.body?.comment }, execute: async () => {
    const draft = await prisma.contentDraft.findFirst({ where: { id: draftId, organizationId: id } });
    if (!draft) throw new NotFoundError('草稿不存在');
    const report = draft.qualityReport as QualityReport;
    if (!report?.passed) throw new ValidationError('质量门禁未通过，不能进入人工发布审批');
    const provenance = draft.dataProvenance as DataProvenance[];
    if (!provenance?.length || provenance.some((item) => !isProductionDataStatus(item.status) || item.status !== 'LIVE')) throw new ValidationError('草稿缺少可用的真实 SEO 数据溯源，不能发布');
    await prisma.$transaction([
      prisma.publishApproval.upsert({ where: { draftId }, create: { draftId, approvedBy: user.id, comment: req.body?.comment ? String(req.body.comment) : undefined }, update: { approvedBy: user.id, comment: req.body?.comment ? String(req.body.comment) : undefined } }),
      prisma.contentDraft.update({ where: { id: draftId }, data: { status: DraftStatus.APPROVED } }),
      prisma.auditEvent.create({ data: { organizationId: id, actorId: user.id, action: 'DRAFT_APPROVED', targetType: 'content_draft', targetId: draftId } })
    ]);
    return { statusCode: 202, response: { job: await jobService.enqueue({ organizationId: id, type: JobType.WORDPRESS_PUBLISH, payload: { draftId }, idempotencyKey: key }) } };
  } });
  res.status(result.statusCode).json(result.response);
}));

export const productionErrorHandler = (error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const appError = error instanceof AppError ? error : undefined;
  const status = appError?.statusCode || 500;
  res.status(status).json({ success: false, error: { code: appError?.errorCode || 'INTERNAL_SERVER_ERROR', message: appError?.message || '服务器内部错误', traceId: (req as any).traceId } });
};
