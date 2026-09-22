type WorkspaceGrowthDraft = {
  version: 1;
  selectedSiteId: string;
  mode: 'KEYWORD' | 'REWRITE' | 'COMPETITOR';
  keywordInput: string;
  rewriteInput: string;
  competitorInput: string;
};

const MAX_DRAFT_FIELD_LENGTH = 20_000;

export const emptyWorkspaceGrowthDraft = (): WorkspaceGrowthDraft => ({
  version: 1,
  selectedSiteId: '',
  mode: 'KEYWORD',
  keywordInput: '',
  rewriteInput: '',
  competitorInput: ''
});

export function parseWorkspaceGrowthDraft(value: string | null): WorkspaceGrowthDraft {
  if (!value) return emptyWorkspaceGrowthDraft();
  try {
    const parsed = JSON.parse(value) as Partial<WorkspaceGrowthDraft>;
    if (parsed.version !== 1) return emptyWorkspaceGrowthDraft();
    const mode = parsed.mode === 'REWRITE' || parsed.mode === 'COMPETITOR' ? parsed.mode : 'KEYWORD';
    const text = (field: unknown) => typeof field === 'string' ? field.slice(0, MAX_DRAFT_FIELD_LENGTH) : '';
    return {
      version: 1,
      selectedSiteId: text(parsed.selectedSiteId),
      mode,
      keywordInput: text(parsed.keywordInput),
      rewriteInput: text(parsed.rewriteInput),
      competitorInput: text(parsed.competitorInput)
    };
  } catch {
    return emptyWorkspaceGrowthDraft();
  }
}
