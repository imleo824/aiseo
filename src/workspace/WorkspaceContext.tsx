import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Me, Organization } from '../types/api';

type WorkspaceContextValue = { me: Me; organization: Organization };
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/me').then(({ data }) => data) });
  if (meQuery.isLoading) return <div className="screen-center">正在加载账号…</div>;
  if (meQuery.error) throw meQuery.error;
  if (!meQuery.data) throw new Error('账号数据不可用');
  const organization = meQuery.data.organizations[0];
  if (!organization) throw new Error('个人工作区初始化失败，请稍后刷新页面');
  const value = useMemo(() => ({ me: meQuery.data!, organization }), [meQuery.data, organization]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export const useWorkspace = () => {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
};
