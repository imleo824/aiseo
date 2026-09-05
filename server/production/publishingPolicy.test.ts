import { describe, expect, it } from 'vitest';
import { defaultPublishingConfirmationPolicy, parsePublishingConfirmationPolicy } from './publishingPolicy';

describe('publishing confirmation policy', () => {
  it('defaults to automatic publishing when the setting is absent', () => {
    expect(parsePublishingConfirmationPolicy(undefined)).toEqual(defaultPublishingConfirmationPolicy);
    expect(defaultPublishingConfirmationPolicy.requireManualConfirmation).toBe(false);
  });

  it('requires confirmation only for the explicit boolean true value', () => {
    expect(parsePublishingConfirmationPolicy({ requireManualConfirmation: true })).toEqual({ requireManualConfirmation: true });
    expect(parsePublishingConfirmationPolicy({ requireManualConfirmation: false })).toEqual({ requireManualConfirmation: false });
    expect(parsePublishingConfirmationPolicy({ requireManualConfirmation: 'true' })).toEqual({ requireManualConfirmation: true });
    expect(parsePublishingConfirmationPolicy({})).toEqual({ requireManualConfirmation: true });
  });
});
