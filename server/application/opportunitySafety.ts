import type { Opportunity } from '../../src/types/seo';

/** A stable comparison key used to prevent the same intent being published twice. */
export const normalizeTopic = (value: string): string => value
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * A rejected quality-gate run may be reworked. All other states, including a
 * published page, must be treated as an existing intent until the product has
 * a dedicated refresh workflow with GSC evidence and a canonical URL target.
 */
export const hasExistingTopic = (opportunities: Opportunity[], siteId: string, keyword: string): boolean => {
  const topic = normalizeTopic(keyword);
  return opportunities.some((opportunity) =>
    opportunity.siteId === siteId
    && opportunity.status !== 'REJECTED'
    && normalizeTopic(opportunity.targetKeyword) === topic
  );
};
