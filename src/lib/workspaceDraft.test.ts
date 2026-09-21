import { describe, expect, it } from 'vitest';
import { emptyWorkspaceGrowthDraft, parseWorkspaceGrowthDraft } from './workspaceDraft';

describe('workspace growth draft', () => {
  it('rejects corrupt and outdated browser state safely', () => {
    expect(parseWorkspaceGrowthDraft('{')).toEqual(emptyWorkspaceGrowthDraft());
    expect(parseWorkspaceGrowthDraft(JSON.stringify({ version: 2, keywordInput: 'stale' }))).toEqual(emptyWorkspaceGrowthDraft());
  });

  it('restores only the supported fields and modes', () => {
    expect(parseWorkspaceGrowthDraft(JSON.stringify({
      version: 1,
      selectedSiteId: 'site-1',
      mode: 'COMPETITOR',
      keywordInput: 'crm',
      rewriteInput: 'https://reference.example',
      competitorInput: 'https://competitor.example',
      ignored: 'value'
    }))).toEqual({
      version: 1,
      selectedSiteId: 'site-1',
      mode: 'COMPETITOR',
      keywordInput: 'crm',
      rewriteInput: 'https://reference.example',
      competitorInput: 'https://competitor.example'
    });
  });
});
