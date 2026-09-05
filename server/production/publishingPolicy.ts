import type { Prisma } from '@prisma/client';

export const PUBLISH_CONFIRMATION_SETTING_KEY = 'publishing.confirmation';

export type PublishingConfirmationPolicy = {
  requireManualConfirmation: boolean;
};

// False is intentional: publishing still requires valid WordPress credentials,
// live data provenance and the deterministic quality gate, but not a review.
export const defaultPublishingConfirmationPolicy: PublishingConfirmationPolicy = {
  requireManualConfirmation: false
};

export const parsePublishingConfirmationPolicy = (value: Prisma.JsonValue | null | undefined): PublishingConfirmationPolicy => {
  if (value === null || value === undefined) return defaultPublishingConfirmationPolicy;
  if (typeof value !== 'object' || Array.isArray(value) || typeof value.requireManualConfirmation !== 'boolean') {
    // Corrupt configuration must never silently widen publishing authority.
    return { requireManualConfirmation: true };
  }
  return { requireManualConfirmation: value.requireManualConfirmation };
};
