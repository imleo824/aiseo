import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Me, Organization } from '../types/api';

type WorkspaceContextValue = { me: Me; organization: Organization };
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/me').then(({ data }) => data) });
  const organization = meQuery.data?.organizations[0];
  const value = useMemo(
    () => meQuery.data && organization ? { me: meQuery.data, organization } : null,
    [meQuery.data, organization]
  );
  if (meQuery.isLoading) return <div className="screen-center">正在加载账号…</div>;
  if (meQuery.error) {
    return <main className="screen-center p-6"><section className="panel max-w-lg space-y-4" role="alert"><h1 className="page-title">工作区正在初始化</h1><p className="muted">账户数据暂时不可用。请稍后重试；若持续出现，请联系平台管理员检查数据库迁移状态。</p><button className="primary" onClick={() => void meQuery.refetch()}>重试</button></section></main>;
  }
  if (!meQuery.data) throw new Error('账号数据不可用');
  if (!organization) throw new Error('个人工作区初始化失败，请稍后刷新页面');
  return <WorkspaceContext.Provider value={value!}>{children}</WorkspaceContext.Provider>;
}

export const useWorkspace = () => {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
};
