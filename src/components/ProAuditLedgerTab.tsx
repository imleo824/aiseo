import React from 'react';
import { ArticleDraft, WordPressSite } from '../types/seo';
import { RecentRecordsList } from './dashboard/RecentRecordsList';

interface ProAuditLedgerTabProps {
  drafts: ArticleDraft[];
  sites: WordPressSite[];
  onApprovePublish?: (draftId: string) => Promise<void>;
  onRejectDraft?: (draftId: string, comment: string) => Promise<void>;
  onRetryPublish?: (draftId: string) => Promise<void>;
  onStartGrowth?: () => void;
}

export const ProAuditLedgerTab: React.FC<ProAuditLedgerTabProps> = ({
  drafts = [],
  sites = [],
  onApprovePublish,
  onRejectDraft,
  onRetryPublish,
  onStartGrowth
}) => {
  return (
    <div className="w-full space-y-6 sm:space-y-8 animate-in fade-in duration-200">
      <RecentRecordsList
        drafts={drafts}
        sites={sites}
        onApprovePublish={onApprovePublish}
        onRejectDraft={onRejectDraft}
        onRetryPublish={onRetryPublish}
        onStartGrowth={onStartGrowth}
      />
    </div>
  );
};
