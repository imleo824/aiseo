import { Prisma, WordPressCompatibilityMode } from '@prisma/client';
import type { TransactionClient } from './prisma';
import {
  blockedWordPressCompatibility,
  wordPressService,
  type WordPressCompatibilityScan
} from './wordpress';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export const scanWordPressCompatibility = async (input: {
  domain: string;
  encryptedCredentials: Uint8Array;
}): Promise<WordPressCompatibilityScan> => {
  try {
    return await wordPressService.scanCompatibility(input.domain, input.encryptedCredentials);
  } catch (error) {
    return blockedWordPressCompatibility(error);
  }
};

export const persistWordPressCompatibility = async (tx: TransactionClient | Prisma.TransactionClient, input: {
  organizationId: string;
  siteId: string;
  scan: WordPressCompatibilityScan;
}) => {
  const profile = await tx.wordPressCompatibilityProfile.create({ data: {
    organizationId: input.organizationId,
    siteId: input.siteId,
    restFingerprint: input.scan.restFingerprint,
    coreVersionEvidence: json(input.scan.coreVersionEvidence),
    authenticationMode: input.scan.authenticationMode,
    routeSchemas: json(input.scan.routeSchemas),
    contentTypes: json(input.scan.contentTypes),
    editorSignals: json(input.scan.editorSignals),
    integrationSignals: json(input.scan.integrationSignals),
    actionCapabilities: json(input.scan.actionCapabilities),
    mode: input.scan.mode as WordPressCompatibilityMode,
    blockReasons: json(input.scan.blockReasons),
    policyVersion: input.scan.policyVersion,
    checkedAt: input.scan.checkedAt,
    expiresAt: input.scan.expiresAt
  } });
  await tx.site.update({
    where: { id: input.siteId },
    data: {
      wordpressCompatibilityMode: input.scan.mode as WordPressCompatibilityMode,
      wordpressCompatibilityCheckedAt: input.scan.checkedAt,
      latestWordpressCompatibilityProfileId: profile.id
    }
  });
  return profile;
};

export const compatibilityProfileResponse = (profile: {
  id: string;
  mode: WordPressCompatibilityMode;
  actionCapabilities: Prisma.JsonValue;
  blockReasons: Prisma.JsonValue;
  coreVersionEvidence: Prisma.JsonValue;
  editorSignals: Prisma.JsonValue;
  integrationSignals: Prisma.JsonValue;
  policyVersion: string;
  checkedAt: Date;
  expiresAt: Date;
  restFingerprint: string;
}) => ({
  id: profile.id,
  mode: profile.mode,
  actionCapabilities: profile.actionCapabilities,
  blockReasons: profile.blockReasons,
  coreVersionEvidence: profile.coreVersionEvidence,
  editorSignals: profile.editorSignals,
  integrationSignals: profile.integrationSignals,
  policyVersion: profile.policyVersion,
  checkedAt: profile.checkedAt,
  expiresAt: profile.expiresAt,
  restFingerprint: profile.restFingerprint
});
