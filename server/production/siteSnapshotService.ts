import { Prisma } from '@prisma/client';
import type { TransactionClient } from './prisma';
import type { SeoMarket } from './seoMarket';
import type { WordPressSiteContext } from './wordpress';

export const SITE_SNAPSHOT_VERSION = 'site-snapshot-1';

const normalizedUrl = (value: string): string => {
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
};

const jsonValue = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export const persistSiteSnapshot = async (tx: TransactionClient, input: {
  organizationId: string;
  siteId: string;
  runId: string;
  context: WordPressSiteContext;
  health: Record<string, unknown>;
  market: SeoMarket;
  audits: Array<{ url: string; evidence: Record<string, unknown> }>;
}) => {
  const existing = await tx.siteSnapshot.findUnique({ where: { runId: input.runId } });
  if (existing) return existing;
  const auditByUrl = new Map(input.audits.flatMap(({ url, evidence }) => {
    try {
      return [[normalizedUrl(url), evidence] as const];
    } catch {
      return [];
    }
  }));
  const inboundCounts = new Map<string, number>();
  for (const page of input.context.pages) {
    for (const link of page.internalLinks) {
      inboundCounts.set(link.url, (inboundCounts.get(link.url) || 0) + 1);
    }
  }
  const snapshot = await tx.siteSnapshot.create({
    data: {
      organizationId: input.organizationId,
      siteId: input.siteId,
      runId: input.runId,
      sourceVersion: SITE_SNAPSHOT_VERSION,
      market: jsonValue(input.market),
      health: jsonValue({
        ...input.health,
        inventory: input.context.inventory,
        site: input.context.site,
        externalAuditProvider: 'DATAFORSEO_ONPAGE',
        externallyAuditedPages: input.audits.length
      }),
      corpusChecksum: input.context.checksum,
      pageCount: input.context.pages.length,
      auditedPageCount: input.audits.length,
      fetchedAt: new Date(input.context.fetchedAt)
    }
  });
  if (input.context.pages.length) {
    await tx.sitePageSnapshot.createMany({
      data: input.context.pages.map((page) => ({
        organizationId: input.organizationId,
        siteId: input.siteId,
        snapshotId: snapshot.id,
        wordpressId: page.wordpressId,
        resourceType: page.resourceType,
        url: page.url,
        slug: page.slug,
        status: page.status,
        modifiedAt: page.modifiedAt ? new Date(page.modifiedAt) : null,
        title: page.title,
        excerpt: page.excerpt || null,
        content: page.content,
        contentChecksum: page.contentChecksum,
        editorKind: page.editorKind,
        structureChecksum: page.structureChecksum,
        actionCapabilities: jsonValue(page.actionCapabilities),
        wordCount: page.wordCount,
        internalLinks: jsonValue(page.internalLinks),
        seoMetadata: jsonValue(page.seoMetadata),
        technicalEvidence: jsonValue({
          onPage: auditByUrl.get(page.url) || null,
          inboundInternalLinks: inboundCounts.get(page.url) || 0,
          orphanCandidate: (inboundCounts.get(page.url) || 0) === 0 && new URL(page.url).pathname !== '/'
        })
      }))
    });
  }
  return snapshot;
};
